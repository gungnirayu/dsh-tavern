import { parse } from 'acorn'

// Legacy harnesses inject host dependencies. Select a whole declaration by AST,
// never by the name or position of whichever function happens to follow it.
export function sourceFunction(source, name) {
  let declaration
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      if (declaration) throw new Error('Ambiguous function: ' + name)
      declaration = node
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }))
  if (!declaration) throw new Error('Missing function: ' + name)
  return source.slice(declaration.start, declaration.end)
}
