import * as ts from 'typescript';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

/**
 * [SYZYGY: THE ALCHEMIST OF TYPES]
 * Transforms TypeScript theme files into JavaScript for runtime import
 */
export function transformThemeFile(themePath: string): string {
  // Create a temporary directory for output
  const tempDir = mkdtempSync(join(tmpdir(), 'animus-theme-'));
  const outputPath = join(tempDir, 'theme.js');

  // Create a minimal tsconfig for compilation
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    noEmit: false,
    outDir: tempDir,
  };

  // Create a program with just the theme file
  const program = ts.createProgram([themePath], compilerOptions);

  // Custom transformer to convert export syntax
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (
    context
  ) => {
    return (sourceFile) => {
      const visitor: ts.Visitor = (node) => {
        // Convert "export const theme" to "module.exports.theme"
        if (
          ts.isVariableStatement(node) &&
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          const declaration = node.declarationList.declarations[0];
          if (ts.isIdentifier(declaration.name)) {
            const name = declaration.name.text;
            return ts.factory.createExpressionStatement(
              ts.factory.createBinaryExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier('module'),
                    'exports'
                  ),
                  name
                ),
                ts.SyntaxKind.EqualsToken,
                declaration.initializer!
              )
            );
          }
        }
        // Convert "export default" to "module.exports ="
        if (ts.isExportAssignment(node) && !node.isExportEquals) {
          return ts.factory.createExpressionStatement(
            ts.factory.createBinaryExpression(
              ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('module'),
                'exports'
              ),
              ts.SyntaxKind.EqualsToken,
              node.expression
            )
          );
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
  };

  // Emit the transformed file
  const result = program.emit(
    undefined,
    (fileName, data) => {
      if (fileName.endsWith('.js')) {
        writeFileSync(outputPath, data);
      }
    },
    undefined,
    false,
    {
      before: [transformerFactory],
    }
  );

  if (result.emitSkipped) {
    throw new Error('Failed to transform theme file');
  }

  return outputPath;
}
