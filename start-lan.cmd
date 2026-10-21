@echo off
setlocal
cd /d "%~dp0"
set "HOST=0.0.0.0"
set "PORT=8765"
echo Starting Xiaoyu for devices on the same network...
echo Open http://YOUR-LAN-IP:8765/#/ on another device.
echo Run ipconfig to find this computer's IPv4 address.
python prototype\server.py
pause
