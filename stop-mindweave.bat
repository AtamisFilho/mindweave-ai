@echo off
rem MindWeave — para o backend (uvicorn :8000) e o frontend (vite :5173).
rem Mata por PORTA (so os processos ouvindo nessas portas) — nunca mata
rem outros processos node/python da maquina.
echo [MindWeave] parando frontend (vite :5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

echo [MindWeave] parando backend (uvicorn :8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

echo [MindWeave] tudo parado. Ate logo!
timeout /t 3 /nobreak >nul
