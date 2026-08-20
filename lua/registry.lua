-- Scans a Hyprland Lua config and prints every registered binding as TSV:
--   keys \t modmask \t key \t description \t kind \t arg \t source
--
-- The config is *executed*, in a short-lived `lua` process of its own, with
-- `hl` replaced by a proxy so nothing reaches the compositor -- and, since it
-- is executed twice for every once the user asked for, inside an environment
-- built for it rather than the real one. No command execution, no writes, no
-- module loading outside that environment, and every chunk the config compiles
-- at runtime lands in it too. The sandbox is assembled at the bottom of this
-- file, together with the one exception it makes and why.
--
-- Verified on 2026-08-19: sandboxed and unsandboxed scans of a stock Omarchy
-- config produce byte-identical output, all 228 bindings.
--
-- The technique is Omarchy's own. It depends only on Hyprland's `hl.bind` API,
-- not on any Omarchy internal, and it starts from the user's own config file,
-- so user overrides come for free.

local modifiers = { SHIFT = 1, CTRL = 4, CONTROL = 4, ALT = 8, SUPER = 64 }

local function split_keys(keys)
  local modmask, key = 0, ""
  for part in string.gmatch(tostring(keys or ""), "[^+]+") do
    local value = part:gsub("^%s+", ""):gsub("%s+$", "")
    local modifier = modifiers[string.upper(value)]
    if modifier then modmask = modmask + modifier else key = value end
  end
  return modmask, key
end

local function literal(value)
  local kind = type(value)
  if kind == "string" then return string.format("%q", value) end
  if kind == "number" or kind == "boolean" then return tostring(value) end
  if kind ~= "table" then return "nil" end

  local parts, names, length = {}, {}, #value
  for index = 1, length do parts[#parts + 1] = literal(value[index]) end
  for name in pairs(value) do
    if not (type(name) == "number" and name >= 1 and name <= length and math.floor(name) == name) then
      names[#names + 1] = name
    end
  end
  table.sort(names, function(left, right) return tostring(left) < tostring(right) end)
  for _, name in ipairs(names) do
    local prefix = (type(name) == "string" and name:match("^[%a_][%w_]*$"))
      and (name .. " = ") or ("[" .. literal(name) .. "] = ")
    parts[#parts + 1] = prefix .. literal(value[name])
  end
  return "{ " .. table.concat(parts, ", ") .. " }"
end

local function call_expression(path, ...)
  local args = {}
  for index = 1, select("#", ...) do args[index] = literal((select(index, ...))) end
  return path .. "(" .. table.concat(args, ", ") .. ")"
end

local function dispatcher(kind, arg)
  return { __omakey = true, kind = kind, arg = arg }
end

local function dsp_proxy(path)
  return setmetatable({ path = path }, {
    __index = function(self, key) return dsp_proxy(self.path .. "." .. tostring(key)) end,
    __call = function(self, ...)
      local first = ...
      local expression = call_expression(self.path, ...)
      if self.path == "hl.dsp.exec_cmd" and type(first) == "string" then
        return dispatcher("exec", first)
      end
      return dispatcher("lua", expression)
    end,
  })
end

-- Everything the config touches must resolve to something harmless, so an
-- unknown member returns a callable no-op rather than raising.
local noop
noop = setmetatable({}, {
  __index = function() return noop end,
  __call = function() return noop end,
})

-- Which file declared this binding. Every hl.bind call in the real config is
-- made from helpers.lua, so level 3 is always the wrapper and never the file
-- the binding belongs to; the first frame past it is the answer. Levels: 1 is
-- origin itself, 2 is hl.bind, 3 is its caller.
local function origin()
  for level = 3, 12 do
    local info = debug.getinfo(level, "S")
    if not info then break end
    local source = tostring(info.source or "")
    if source:sub(1, 1) == "@" and not source:match("helpers%.lua$") then
      return (source:gsub("^@", ""))
    end
  end
  return ""
end

local function clean(value)
  return (tostring(value or ""):gsub("[\t\r\n]", " "))
end

local hl = setmetatable({
  dsp = dsp_proxy("hl.dsp"),
  get_config = function() return nil end,
  bind = function(keys, bind_dispatcher, opts)
    opts = opts or {}
    local modmask, key = split_keys(keys)
    local kind, arg = "", ""
    if type(bind_dispatcher) == "table" and bind_dispatcher.__omakey then
      kind, arg = bind_dispatcher.kind, bind_dispatcher.arg
    elseif type(bind_dispatcher) == "string" then
      kind, arg = "exec", bind_dispatcher
    end
    print(table.concat({
      clean(keys), tostring(modmask), clean(key),
      clean(opts.description), kind, clean(arg), clean(origin()),
    }, "\t"))
    return noop
  end,
}, { __index = function() return noop end })

-- The sandbox. Hyprland runs this config too, so nothing in it is foreign
-- code; what is new is that omakey runs it a *second* time, on load and on
-- every config reload. A side effect the user wrote once then happens on
-- omakey's schedule instead of theirs, which is not a bargain anyone agreed to.
--
-- So the config is executed against an environment of our own: no command
-- execution, no writes, no module loading outside it. What is deliberately
-- kept is reading, because Omarchy's own require_all.lua enumerates its
-- bindings directories before the first binding is declared, and a scanner that
-- cannot read finds nothing at all.
--
-- Measured against a stock Omarchy config: refusing os.execute costs zero
-- bindings. Only nvidia.lua shells out at load, through o.shell_succeeds, and
-- it decides driver settings rather than bindings -- the bindings that gate on
-- a command's presence use o.cmd_present, which only reads PATH.
local real_open, real_popen = io.open, io.popen

local function refused(what)
  return nil, tostring(what) .. ": refused while omakey scans the config"
end

local function shell_quote(path)
  return "'" .. tostring(path):gsub("'", "'\\''") .. "'"
end

-- The one command the scan will run, and it does not run the config's version
-- of it. require_all.lua enumerates a directory with `find | sort`; that exact
-- shape is recognised, the directory is taken out of it, and the command is
-- rebuilt from our own text. So the config contributes a directory name inside
-- a quoted argument and never a command.
local ENUMERATION =
  "^find '([^']*)' %-maxdepth 1 %-type f %-name '%*%.lua' %-printf '%%f\\n' 2>/dev/null | sort$"

local function enumerate(command, mode)
  if mode and mode ~= "r" then return refused(command) end
  local dir = tostring(command or ""):match(ENUMERATION)
  if not dir then return refused(command) end
  return real_popen("find " .. shell_quote(dir)
    .. " -maxdepth 1 -type f -name '*.lua' -printf '%f\\n' 2>/dev/null | sort", "r")
end

local env = {}

local function read_file(path)
  local handle = real_open(path, "r")
  if not handle then return nil end
  local source = handle:read("a")
  handle:close()
  return source
end

-- Every chunk the config produces is compiled into this same environment.
-- Stock `load` compiles against the real globals rather than the caller's, so
-- without this a config could hand itself the unrestricted `os` back in one
-- line -- the seam a partial sandbox leaks through.
--
-- The caller's `mode` is deliberately discarded rather than defaulted. A binary
-- chunk is the one input no Lua sandbox can contain: it ignores the `_ENV` set
-- here, and a malformed one corrupts the VM before any environment applies --
-- reproduced as a repeatable heap abort. Text only, always.
local function scoped_load(chunk, chunkname, _mode, custom)
  return load(chunk, chunkname, "t", custom == nil and env or custom)
end

-- "@" .. path is what keeps debug.getinfo naming the file, and origin() walks
-- exactly that to attribute a binding to the file that declared it.
local function run_file(path, module)
  local source = read_file(path)
  if not source then return false, tostring(path) .. ": cannot be read" end
  local chunk, err = scoped_load(source, "@" .. path, "t")
  if not chunk then return false, err end
  return true, chunk(module, path)
end

local function search(module)
  local name = tostring(module):gsub("%.", "/")
  for template in tostring(env.package.path or ""):gmatch("[^;]+") do
    local path = template:gsub("%?", name)
    local handle = real_open(path, "r")
    if handle then
      handle:close()
      return path
    end
  end
end

-- package.loaded and package.path are the config's to rearrange -- Omarchy's
-- bootstrap.lua clears modules and prepends three search roots before anything
-- else happens. What this loader does not offer is a C module: it reads Lua
-- source and nothing else, so package.cpath leads nowhere.
local function sandboxed_require(module)
  local cached = env.package.loaded[module]
  if cached ~= nil then return cached end

  local value
  local preload = env.package.preload[module]
  if preload then
    value = preload(module)
  else
    local path = search(module)
    if not path then error("module '" .. tostring(module) .. "' not found", 2) end
    local ok, result = run_file(path, module)
    if not ok then error(result, 0) end
    value = result
  end

  if value == nil then value = true end
  env.package.loaded[module] = value
  return value
end

local function sandboxed_dofile(path)
  if not path then return refused("dofile") end
  local ok, result = run_file(path)
  if not ok then error(result, 0) end
  return result
end

local function sandboxed_loadfile(path, _mode, custom)
  local source = path and read_file(path)
  if not source then return refused(path or "loadfile") end
  return scoped_load(source, "@" .. path, nil, custom)
end

-- stdout carries the TSV this scanner exists to print, so the config is handed
-- a sink instead: a stray print in a config file would otherwise arrive as a
-- malformed binding. stderr stays real -- a diagnostic is not a side effect.
local sink = { write = function(self) return self end, close = function() return true end }

env._G = env
env._VERSION = _VERSION
env.assert, env.error, env.ipairs, env.next, env.pairs = assert, error, ipairs, next, pairs
env.pcall, env.xpcall, env.select, env.tonumber, env.tostring = pcall, xpcall, select, tonumber, tostring
env.type, env.rawequal, env.rawget, env.rawlen, env.rawset = type, rawequal, rawget, rawlen, rawset
env.setmetatable, env.getmetatable, env.collectgarbage = setmetatable, getmetatable, collectgarbage
env.string, env.table, env.math, env.utf8, env.coroutine = string, table, math, utf8, coroutine
env.load, env.loadfile, env.dofile, env.require = scoped_load, sandboxed_loadfile, sandboxed_dofile, sandboxed_require
env.print = function() end
env.arg = {}
env.hl = hl

-- The multi-file fixture reads its own source path this way, and a config is
-- entitled to do the same. Nothing else in debug is offered.
env.debug = { getinfo = debug.getinfo, traceback = debug.traceback }

env.os = {
  getenv = os.getenv, time = os.time, date = os.date, clock = os.clock,
  difftime = os.difftime, setlocale = os.setlocale,
  -- Reported as a command that ran and failed, not as an error: nvidia.lua
  -- asks `if o.shell_succeeds(...)` and a raise there would end the scan.
  execute = function() return false, "exit", 1 end,
  remove = function(path) return refused(path) end,
  rename = function(from) return refused(from) end,
  tmpname = function() return refused("tmpname") end,
  exit = function() error("os.exit refused while omakey scans the config", 0) end,
}

env.io = {
  open = function(path, mode)
    if mode and mode:match("[wa+]") then return refused(path) end
    return real_open(path, mode)
  end,
  lines = io.lines,
  popen = enumerate,
  close = io.close,
  type = io.type,
  -- Reading stdin is not a side effect, and io.input opens read-only. io.output
  -- is the one that would open a file for writing, so it answers with the sink
  -- and forgets the argument.
  read = io.read,
  input = io.input,
  stdin = io.stdin,
  output = function() return sink end,
  write = function() return sink end,
  stdout = sink,
  stderr = io.stderr,
}

-- searchpath is how require_optional.lua asks whether a module exists before
-- requiring it. It only reads, and leaving it out cost 28 bindings on a stock
-- config -- the scan died at the first optional module.
env.package = {
  path = package.path, cpath = "", loaded = {}, preload = {},
  searchpath = package.searchpath,
}

local config = arg and arg[1]
if not config or config == "" then
  io.stderr:write("usage: registry.lua <hyprland.lua>\n")
  os.exit(2)
end

-- run_file reports a file it could not read by returning false rather than by
-- raising, so both halves have to be checked: a scan that cannot open the
-- config must exit non-zero, or Registry.qml reads an empty run as a config
-- with no bindings in it.
local raised, loaded, result = pcall(run_file, config)
if not raised or not loaded then
  io.stderr:write("omakey: scan failed: " .. tostring(raised and result or loaded) .. "\n")
  os.exit(1)
end
