-- Scans a Hyprland Lua config and prints every registered binding as TSV:
--   keys \t modmask \t key \t description \t kind \t arg \t source
--
-- This is not a sandbox, and calling it one would be a lie worth correcting:
-- the config is *executed*, in a short-lived `lua` process of its own, with
-- `hl` replaced by a proxy so nothing reaches the compositor. The standard
-- library is the config's own, exactly as it is under Hyprland -- which is the
-- same thing Omarchy's `omarchy-menu-keybindings` does with the same file.
--
-- What is contained is effects: a scan must not change anything. See the
-- read-only shims below for what that covers and what it deliberately does not.
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

hl = setmetatable({
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

-- Hyprland runs this config too, so nothing here is foreign code. What is new
-- is the second execution: omakey scans on load and again on every config
-- reload, and a config that writes a file on load would write it every time,
-- outside the moment the user meant it to happen. So the filesystem is made
-- read-only for the length of the scan.
--
-- Reads are untouched on purpose. Omarchy's own require_all.lua enumerates its
-- bindings directories through io.popen before a single binding is declared, so
-- a scanner that cannot read is a scanner that returns nothing at all.
--
-- What this does not contain, stated plainly rather than implied: os.execute
-- and a read-mode io.popen still run their command. The stock config uses both
-- -- three `find` calls and one hardware probe, measured on 2026-08-19 -- and
-- refusing them would leave the plugin silent on a default install. A command
-- the config chooses to run is beyond what this file can honestly promise.
local real_open, real_popen = io.open, io.popen

local function refused(what)
  return nil, tostring(what) .. ": read-only while omakey scans the config"
end

io.open = function(path, mode)
  if mode and mode:match("[wa+]") then return refused(path) end
  return real_open(path, mode)
end

io.popen = function(command, mode)
  if mode and mode:match("w") then return refused(command) end
  return real_popen(command, mode)
end

os.remove = function(path) return refused(path) end
os.rename = function(from) return refused(from) end

local config = arg and arg[1]
if not config or config == "" then
  io.stderr:write("usage: registry.lua <hyprland.lua>\n")
  os.exit(2)
end

local ok, err = pcall(dofile, config)
if not ok then
  io.stderr:write("omakey: scan failed: " .. tostring(err) .. "\n")
  os.exit(1)
end
