# Dogfooding MindWeave — guia rápido

Você está usando o MindWeave de verdade, todos os dias, num projeto real.
O objetivo: sentir o que falta antes de construir a próxima versão.

## Como iniciar

Duplo clique no atalho **Iniciar MindWeave** (área de trabalho).
Ele sobe o backend e o frontend e abre o navegador em
`http://localhost:5173`. As duas janelas pretas que aparecerem são os
serviços — pode minimizá-las (ou fechar a janelinha inicial "pronto").

## Como usar

Mapeie como mapearia qualquer projeto seu:

- Duplo clique no nó para editar; **Enter cria um filho, Tab cria um
  irmão** (na raiz, outra raiz) — o novo nó já abre em edição, dá para
  digitar em rajada.
- Errou? **Ctrl+Z** desfaz (e Ctrl+Shift+Z refaz) — inclusive lote de IA.
- Selecione um nó para ver **Pesquisa IA** e **Sugerir Nós IA**; selecione
  vários (Ctrl+clique) e use **Expandir N nós com IA**.
- Menu **Mapas ▸ 📄 Resumir mapa** pede um resumo na aba Chat; o chat
  responde sobre o conteúdo do mapa.
- **Mapas ▸ Exportar ▸ Markdown (.md)** baixa o outline do mapa.
- Tudo é salvo sozinho (indicador no topo: "Salvo há Xs").

## Como anotar fricções

Sempre que algo te travar, irritar ou te obrigar a dar contorno:

1. Duplo clique no atalho **MindWeave — Log de Fricções** (área de trabalho).
2. Adicione uma entrada NO FIM do arquivo, no formato:

```
## 2026-10-03 — contexto curto (ex: criando nós no capítulo 2)
- **Fricção:** não consegui achar um nó antigo sem caçar no zoom
- **Severidade:** média
- **Contorno usado:** usei o minimapa para achar aproximadamente
```

Severidade: **alta** (trabalho parado) · **média** (contorno custoso) ·
**baixa** (incômodo). Anote no calor — contorno usado é ouro para
priorizar.

## Como parar

Duplo clique no atalho **Parar MindWeave** (área de trabalho). Ele mata
apenas os serviços nas portas 8000 e 5173 — nada mais na máquina. O que
você mapeou já está salvo no banco; pode fechar o navegador depois.

## Quando voltar aqui

Após **~1 semana de uso** ou **5+ entradas no log**, volte para a sessão
do projeto: a triagem roda em três baldes (**v0.6.x agora / v1.0 depois /
morre**) e nasce a primeira micro-release.
