# VewKod

AI-powered code explainer built with React + Vite. Paste a code snippet
and get a clear, structured explanation — either from the AI backend, or
from a local rule-based fallback engine when the backend is unreachable.

[Edit in StackBlitz next generation editor ⚡️](https://stackblitz.com/~/github.com/abuserdeeq/VewKod)

## Setup

```bash
npm install
cp .env.example .env   # set VITE_API_BASE_URL if not using the default
npm run dev
```

## Testing

Two separate test suites:

```bash
npm run test        # local-engine analyzers (Node's built-in test runner)
npm run test:ui      # React component tests (Vitest + Testing Library)
npm run test:ui:watch
npm run test:all     # both suites
```
