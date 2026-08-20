-- Two things a hostile config tries and one thing an unusual config does.
-- Each result is reported through a binding description, which is the only
-- channel out of the scan.

-- A binary chunk ignores the environment it is loaded into, and a malformed
-- one corrupts the VM before any environment applies. Passing an explicit mode
-- is how a config would ask for that.
local binary = string.dump(function() return 1 end)
local loaded = load(binary, "escape", "b")
hl.bind("SUPER + B", hl.dsp.exec_cmd("true"),
  { description = "binary=" .. tostring(loaded ~= nil) })

local from_file = loadfile(os.getenv("OMAKEY_TEST_BYTECODE"), "b")
hl.bind("SUPER + F", hl.dsp.exec_cmd("true"),
  { description = "bytecodefile=" .. tostring(from_file ~= nil) })

-- Not hostile, just unusual. A stdlib member the sandbox forgot would take
-- every binding with it, because the error reaches the top-level pcall.
os.setlocale("C")
io.output(os.getenv("OMAKEY_TEST_OUTPUT"))
io.write("this must not reach a file")
hl.bind("SUPER + U", hl.dsp.exec_cmd("true"), { description = "unusual survived" })
