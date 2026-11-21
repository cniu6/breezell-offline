@echo off
chcp 65001 >nul
set CLI=%USERPROFILE%\Breezell-Work\patch\breezell-offline\pkg\extension\src\patchCli.js
set EXE=%LOCALAPPDATA%\Programs\Breezell\Breezell.exe
node "%CLI%" apply >nul 2>nul
start "" "%EXE%"