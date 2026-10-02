@echo off
rem MindWeave — inicia backend (uvicorn :8000) e frontend (vite :5173)
rem e abre o navegador. As janelas dos servicos ficam abertas; para tudo,
rem use o atalho "Parar MindWeave".
cd /d "%~dp0"

echo [MindWeave] iniciando backend (uvicorn :8000)...
start "MindWeave - Backend (uvicorn)" /D "%~dp0backend" "%~dp0backend\venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo [MindWeave] iniciando frontend (vite :5173)...
start "MindWeave - Frontend (vite)" /D "%~dp0frontend" cmd /c "npm run dev -- --port 5173 --strictPort"

echo [MindWeave] aguardando os servicos subirem...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173

echo [MindWeave] pronto: http://localhost:5173
echo [MindWeave] esta janela pode ser fechada (os servicos continuam rodando).
timeout /t 5 /nobreak >nul
