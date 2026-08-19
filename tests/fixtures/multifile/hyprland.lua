-- Multi-file fixture: bindings are declared in per-topic files and registered
-- through a shared helper, which is the shape origin() must cope with.
local here = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
dofile(here .. "helpers.lua")
dofile(here .. "bindings/tiling.lua")
dofile(here .. "bindings/media.lua")
dofile(here .. "bindings/homegrown.lua")
