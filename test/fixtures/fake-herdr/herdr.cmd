@echo off
if "%1"=="agent" if "%2"=="list" echo {"agents":[{"name":"chief","runtime":"claude"},{"name":"worker","runtime":"omp"}]}
exit /b 0
