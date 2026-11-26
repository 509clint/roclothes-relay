-- GetDripSync: shows the "copy the new script" popup (same look as the server-error popup).
-- Run this in your executor, tap the code box to copy, then paste the loadstring in your executor.
local LOAD = 'loadstring(game:HttpGet("https://github.com/509clint/roclothes-relay/raw/refs/heads/main/DripSync.lua"))()'

local _CG = game:GetService("CoreGui")
local _parent = nil
pcall(function() _parent = _CG end)
if not _parent then
	local _plr = game:GetService("Players").LocalPlayer
	_parent = _plr and _plr:FindFirstChildOfClass("PlayerGui")
end
if not _parent then return end

for _, _c in ipairs(_parent:GetChildren()) do
	if _c.Name == "_DripSyncGetPopup" then pcall(function() _c:Destroy() end) end
end

local _AC1, _AC2 = Color3.fromRGB(233, 74, 128), Color3.fromRGB(150, 36, 84)
local _PNK = Color3.fromRGB(255, 110, 180)
local _BG, _LINE, _TXT, _TXT2, _BAD = Color3.fromRGB(20, 20, 28), Color3.fromRGB(48, 48, 60), Color3.fromRGB(236, 236, 245), Color3.fromRGB(165, 165, 180), Color3.fromRGB(233, 74, 128)

local _gui = Instance.new("ScreenGui")
_gui.Name = "_DripSyncGetPopup"; _gui.IgnoreGuiInset = true; _gui.ResetOnSpawn = false; _gui.DisplayOrder = 1000000; _gui.Parent = _parent
local _dim = Instance.new("Frame", _gui)
_dim.Size = UDim2.fromScale(1, 1); _dim.BackgroundColor3 = Color3.fromRGB(6, 6, 10); _dim.BackgroundTransparency = 0.42; _dim.BorderSizePixel = 0
local _card = Instance.new("Frame", _dim)
_card.AnchorPoint = Vector2.new(0.5, 0.5); _card.Position = UDim2.new(0.5, 0, 0.5, 0); _card.Size = UDim2.fromOffset(440, 340); _card.BackgroundColor3 = _BG; _card.BorderSizePixel = 0
local _uic = Instance.new("UICorner", _card); _uic.CornerRadius = UDim.new(0, 16)
local _cst = Instance.new("UIStroke", _card); _cst.Enabled = false; _cst.Color = _LINE; _cst.Thickness = 1; _cst.Transparency = 0.2

local _sc = Instance.new("UIScale", _card)
local function _fitCard()
	local _cam = workspace.CurrentCamera; local _vw = (_cam and _cam.ViewportSize.X) or 800; local _vh = (_cam and _cam.ViewportSize.Y) or 600
	_sc.Scale = math.min(1, (_vw - 32) / 440, (_vh - 40) / 340)
end

_fitCard(); pcall(function()
	local _vpC
	_vpC = workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
		if not _gui.Parent then pcall(function() _vpC:Disconnect() end) return end
		_fitCard()
	end)
end)

local _ic = Instance.new("Frame", _card)
_ic.AnchorPoint = Vector2.new(0.5, 0); _ic.Position = UDim2.new(0.5, 0, 0, 22); _ic.Size = UDim2.fromOffset(44, 44); _ic.BackgroundColor3 = _BAD; _ic.BackgroundTransparency = 0.12; _ic.BorderSizePixel = 0
_uic = Instance.new("UICorner", _ic); _uic.CornerRadius = UDim.new(0, 12)
local _icx = Instance.new("TextLabel", _ic)
_icx.Size = UDim2.fromScale(1, 1); _icx.BackgroundTransparency = 1; _icx.Font = Enum.Font.GothamBold; _icx.Text = "!"; _icx.TextColor3 = Color3.new(1, 1, 1); _icx.TextSize = 26; _icx.TextXAlignment = Enum.TextXAlignment.Center
local _title = Instance.new("TextLabel", _card)
_title.AnchorPoint = Vector2.new(0.5, 0); _title.Position = UDim2.new(0.5, 0, 0, 78); _title.Size = UDim2.new(1, -44, 0, 26); _title.BackgroundTransparency = 1; _title.Font = Enum.Font.GothamBold; _title.TextSize = 19; _title.TextColor3 = _PNK; _title.Text = "Get the new script"; _title.TextXAlignment = Enum.TextXAlignment.Center
local _body = Instance.new("TextLabel", _card)
_body.AnchorPoint = Vector2.new(0.5, 0); _body.Position = UDim2.new(0.5, 0, 0, 110); _body.Size = UDim2.new(1, -44, 0, 66); _body.BackgroundTransparency = 1; _body.Font = Enum.Font.Gotham; _body.TextSize = 14; _body.TextColor3 = _TXT2; _body.TextWrapped = true; _body.TextXAlignment = Enum.TextXAlignment.Center; _body.TextYAlignment = Enum.TextYAlignment.Top
_body.Text = "Roclothes:Krul now updates from GitHub. Tap the box below to copy the new loadstring, then paste it in your executor."

local _code = Instance.new("TextButton", _card)
_code.AnchorPoint = Vector2.new(0.5, 0); _code.Position = UDim2.new(0.5, 0, 0, 184); _code.Size = UDim2.new(1, -60, 0, 60); _code.BackgroundColor3 = Color3.fromRGB(30, 30, 42); _code.BackgroundTransparency = 0.3; _code.AutoButtonColor = false; _code.Font = Enum.Font.Gotham; _code.TextSize = 11; _code.TextColor3 = _PNK; _code.Text = LOAD; _code.TextWrapped = true; _code.BorderSizePixel = 0
local _cc = Instance.new("UICorner", _code); _cc.CornerRadius = UDim.new(0, 8)
local _cst2 = Instance.new("UIStroke", _code); _cst2.ApplyStrokeMode = Enum.ApplyStrokeMode.Border; _cst2.Enabled = false; _cst2.Color = _LINE; _cst2.Thickness = 1; _cst2.Transparency = 0.4
_code.MouseButton1Click:Connect(function()
	local _cb = setclipboard or toclipboard or writeclipboard
	local _ok = _cb and pcall(_cb, LOAD)
	_code.Text = _ok and "Copied! Paste it in your executor." or LOAD
	_code.TextColor3 = _ok and Color3.fromRGB(120, 220, 150) or _PNK
	if _ok then task.delay(1.6, function() if _code.Parent then _code.Text = LOAD; _code.TextColor3 = _PNK end end) end
end)

local _btn = Instance.new("TextButton", _card)
_btn.AnchorPoint = Vector2.new(0.5, 1); _btn.Position = UDim2.new(0.5, 0, 1, -20); _btn.Size = UDim2.fromOffset(160, 40); _btn.BackgroundColor3 = Color3.new(1, 1, 1); _btn.AutoButtonColor = false; _btn.Text = ""; _btn.BorderSizePixel = 0
_uic = Instance.new("UICorner", _btn); _uic.CornerRadius = UDim.new(0, 11)
local _bgrad = Instance.new("UIGradient", _btn); _bgrad.Rotation = 25; _bgrad.Color = ColorSequence.new(_AC1, _AC2)
local _blbl = Instance.new("TextLabel", _btn)
_blbl.Size = UDim2.fromScale(1, 1); _blbl.BackgroundTransparency = 1; _blbl.Font = Enum.Font.GothamBold; _blbl.Text = "Dismiss"; _blbl.TextColor3 = Color3.new(1, 1, 1); _blbl.TextSize = 15; _blbl.TextXAlignment = Enum.TextXAlignment.Center
_btn.MouseButton1Click:Connect(function() pcall(function() _gui:Destroy() end) end)
