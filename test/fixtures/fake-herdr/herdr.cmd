@echo off
node "%~dp0herdr-fixture.cjs" %*
exit /b %ERRORLEVEL%
