-- Fixture config for the registry scanner.
--
-- `o.bind` lives in Omarchy's helpers.lua, which the real config loads through
-- its bootstrap. This fixture runs standalone, so it carries its own copy --
-- see /usr/share/omarchy/default/hypr/helpers.lua:81.
o = {
  bind = function(keys, description, dispatcher, options)
    local opts = options or {}
    if description then opts.description = description end
    if type(dispatcher) == "string" then dispatcher = hl.dsp.exec_cmd(dispatcher) end
    hl.bind(keys, dispatcher, opts)
  end,
}

o.bind("SUPER + W", "Close window", hl.dsp.window.close())
o.bind("SUPER + RETURN", "Terminal", "omarchy-launch-terminal")
o.bind("SUPER + code:12", "Switch to workspace 3", hl.dsp.focus({ workspace = "3" }))
o.bind("SUPER + mouse:272", "Move window", hl.dsp.window.drag(), { mouse = true })

-- No description on purpose: the scanner must still emit it. Omarchy's menu
-- filters descriptionless bindings for display; omakey needs them all for
-- suppression.
hl.bind("SUPER + Q", hl.dsp.window.close(), {})
