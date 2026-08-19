-- Cursor activity poller, injected into the live compositor the same way the
-- shadow bindings are. It reports only transitions -- the moment the cursor
-- starts moving and the moment it stops -- so the stream stays quiet while the
-- cursor sits still, which is most of the time.
--
-- hl.timer's real signature, measured against Hyprland 0.56.2 on 2026-08-19:
--
--   hl.timer(callback, { timeout = <milliseconds>, type = "repeat"|"oneshot" })
--
-- The callback comes first, the options are a table, and the timeout is in
-- milliseconds. An opts.type outside those two words is refused outright and no
-- timer is created. Omarchy uses the oneshot form in
-- default/hypr/bindings/clipboard.lua:12.
--
-- The sentinel matters as much as the poller. A timer lives in Hyprland, not in
-- the shell, so it survives a plugin reload exactly as the shadow bindings do;
-- without the guard every reload would leave another poller running in the same
-- VM, and only `hyprctl reload` could clear them.
if not omakey_cursor then
  omakey_cursor = { x = -1, y = -1, moving = false, primed = false }

  omakey_cursor.timer = hl.timer(function()
    local ok, position = pcall(hl.get_cursor_pos)
    if not ok or type(position) ~= "table" then return end

    -- The first tick only establishes where the cursor already was. Reporting
    -- a transition from the -1 sentinel would claim movement that never
    -- happened, at whatever moment the payload was injected.
    if not omakey_cursor.primed then
      omakey_cursor.primed = true
      omakey_cursor.x, omakey_cursor.y = position.x, position.y
      return
    end

    local now_moving = (position.x ~= omakey_cursor.x or position.y ~= omakey_cursor.y)
    omakey_cursor.x, omakey_cursor.y = position.x, position.y

    if now_moving ~= omakey_cursor.moving then
      omakey_cursor.moving = now_moving
      -- Colon-separated: socket2 splits an event payload on commas.
      hl.dispatch(hl.dsp.event(string.format(
        "omakey,cursor:%s:%d:%d",
        now_moving and "moving" or "idle",
        math.floor(position.x),
        math.floor(position.y)
      )))
    end
  end, { timeout = 100, type = "repeat" })
end
