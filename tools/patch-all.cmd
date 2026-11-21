@echo off
chcp 65001 >nul
title Breezell ?? - ????
set CLI=%USERPROFILE%\Breezell-Work\patch\breezell-offline\pkg\extension\src\patchCli.js
where node >nul 2>nul || (echo [x] ??? node.exe???? Node.js & pause & exit /b 1)
node -e "try{var f=process.env.APPDATA+'\\Breezell\\hot-runtime\\current.json',fs=require('fs'),j=JSON.parse(fs.readFileSync(f,'utf8'));if(j.bootAttempts){j.bootAttempts=0;fs.writeFileSync(f,JSON.stringify(j,null,2));console.log('[i] bootAttempts ???')}else console.log('[i] bootAttempts ?? 0')}catch(e){console.log('[i] ?? current.json: '+e.message)}"
echo == ??? ==
node "%CLI%" apply
echo.
echo == ?? ==
node "%CLI%" status
echo.
pause