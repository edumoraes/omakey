-- A config whose load has side effects. Hyprland would run these; a scan of
-- the same file must not. The paths arrive by environment so the test can
-- point them at a directory it owns.
local created = os.getenv("OMAKEY_TEST_CREATE")
local file = io.open(created, "w")
if file then
  file:write("the scan wrote this")
  file:close()
end

os.remove(os.getenv("OMAKEY_TEST_DELETE"))
os.rename(os.getenv("OMAKEY_TEST_DELETE"), created)

-- Reading has to keep working: Omarchy's own require_all enumerates its
-- bindings directories before a single binding is declared.
local readable = io.open(os.getenv("OMAKEY_TEST_DELETE"), "r")
local seen = readable and readable:read("l") or "unreadable"
if readable then readable:close() end

hl.bind("SUPER + T", hl.dsp.exec_cmd("true"), { description = "Probe " .. seen })
