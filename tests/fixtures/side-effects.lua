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

-- Shelling out is the same side effect by another route.
os.execute("touch " .. (os.getenv("OMAKEY_TEST_EXEC") or "/dev/null"))
local pipe = io.popen("touch " .. (os.getenv("OMAKEY_TEST_POPEN") or "/dev/null"))
if pipe then pipe:close() end

-- Code the config builds at runtime must land in the same environment it does.
-- In stock Lua, load() compiles against the real globals, so this is the seam
-- where a sandbox that only replaces the caller's environment leaks.
local escape = load("return os")
if escape then
  local reached = escape()
  if reached and reached.execute then
    reached.execute("touch " .. (os.getenv("OMAKEY_TEST_LOADED") or "/dev/null"))
  end
end

-- Reading has to keep working: Omarchy's own require_all enumerates its
-- bindings directories before a single binding is declared.
local readable = io.open(os.getenv("OMAKEY_TEST_DELETE"), "r")
local seen = readable and readable:read("l") or "unreadable"
if readable then readable:close() end

hl.bind("SUPER + T", hl.dsp.exec_cmd("true"), { description = "Probe " .. seen })
