// Production rendering skips development-only markup and dependency audits.
// Use npm run dev when changing pages; measure with npm run start:demo.
process.env.NODE_ENV = 'production'
await import('../src/main.ts')
