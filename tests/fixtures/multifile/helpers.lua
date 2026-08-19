-- Mirrors /usr/share/omarchy/default/hypr/helpers.lua:81. Its only job in this
-- fixture is to be the wrapper frame that origin() has to walk past: in the
-- real config every hl.bind call is made from here, never from the file that
-- the binding actually belongs to.
o = {
  bind = function(keys, description, dispatcher, options)
    local opts = options or {}
    if description then opts.description = description end
    if type(dispatcher) == "string" then dispatcher = hl.dsp.exec_cmd(dispatcher) end
    hl.bind(keys, dispatcher, opts)
  end,
}
