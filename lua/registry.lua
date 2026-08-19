-- Scans a Hyprland Lua config and prints every registered binding as TSV:
--   keys \t modmask \t key \t description \t kind \t arg
-- Runs the config inside a sandbox where `hl` is a proxy, so nothing reaches
-- the compositor. Never import this into a live Hyprland VM.
--
-- The technique is Omarchy's own -- see omarchy-menu-keybindings. It depends
-- only on Hyprland's `hl.bind` API, not on any Omarchy internal, and it starts
-- from the user's own config file, so user overrides come for free.

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
      clean(opts.description), kind, clean(arg),
    }, "\t"))
    return noop
  end,
}, { __index = function() return noop end })

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
