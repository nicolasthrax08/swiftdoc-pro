import { existsSync, statSync } from "node:fs";
import path from "node:path";

const INDEX_FILE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

function unwrapExpression(node) {
  if (!node) {
    return null;
  }

  if (node.type === "ChainExpression") {
    return node.expression;
  }

  return node;
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function getStaticPropertyName(node) {
  if (!node) {
    return null;
  }

  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && typeof node.property?.value === "string") {
    return node.property.value;
  }

  if (
    node.computed &&
    node.property?.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    return node.property.quasis[0]?.value.cooked ?? null;
  }

  return null;
}

function isUseEffectCall(node) {
  if (node.type !== "CallExpression") {
    return false;
  }

  const callee = unwrapExpression(node.callee);

  if (isIdentifier(callee, "useEffect")) {
    return true;
  }

  return (
    callee?.type === "MemberExpression" &&
    getStaticPropertyName(callee) === "useEffect"
  );
}

function getFunctionName(node) {
  if (node.id?.type === "Identifier") {
    return node.id.name;
  }

  if (
    node.parent?.type === "VariableDeclarator" &&
    node.parent.id.type === "Identifier"
  ) {
    return node.parent.id.name;
  }

  if (
    node.parent?.type === "AssignmentExpression" &&
    node.parent.left.type === "Identifier"
  ) {
    return node.parent.left.name;
  }

  return null;
}

function isTrackedFunction(node) {
  const name = getFunctionName(node);

  if (!name) {
    return false;
  }

  return name.startsWith("use") || /^[A-Z]/u.test(name);
}

function isApiImport(source) {
  return (
    source.startsWith("@/api/") ||
    /^\.{1,2}\/.*\/api(\/|$)/u.test(source) ||
    /^\.{1,2}\/api(\/|$)/u.test(source)
  );
}

function isValueImportSpecifier(specifier) {
  if (
    specifier.type === "ImportDefaultSpecifier" ||
    specifier.type === "ImportNamespaceSpecifier"
  ) {
    return true;
  }

  return specifier.type === "ImportSpecifier" && specifier.importKind !== "type";
}

function hasValueImportSpecifier(node) {
  if (node.importKind === "type") {
    return false;
  }

  return node.specifiers.some(isValueImportSpecifier);
}

function isFunctionNode(node) {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

function collectLocalFunctionBindings(node) {
  const bindings = new Map();
  const stack = [node];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || typeof current !== "object") {
      continue;
    }

    if (current.type === "FunctionDeclaration" && current.id?.type === "Identifier") {
      bindings.set(current.id.name, current);
    }

    if (
      current.type === "VariableDeclarator" &&
      current.id.type === "Identifier" &&
      isFunctionNode(current.init)
    ) {
      bindings.set(current.id.name, current.init);
    }

    if (current !== node && isFunctionNode(current)) {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (key === "parent") {
        continue;
      }

      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const item = value[index];
          if (item && typeof item === "object" && "type" in item) {
            stack.push(item);
          }
        }
        continue;
      }

      if (value && typeof value === "object" && "type" in value) {
        stack.push(value);
      }
    }
  }

  return bindings;
}

function collectImportNames(node, state) {
  const source = node.source.value;

  if (typeof source !== "string" || node.importKind === "type") {
    return;
  }

  for (const specifier of node.specifiers) {
    if (!isValueImportSpecifier(specifier)) {
      continue;
    }

    if (specifier.local.type !== "Identifier") {
      continue;
    }

    if (state.axiosImports && source === "axios") {
      state.axiosImports.add(specifier.local.name);
    }

    if (
      state.useEffectAliases &&
      source === "react" &&
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "useEffect" &&
      specifier.local.name !== "useEffect"
    ) {
      state.useEffectAliases.add(specifier.local.name);
    }

    if (
      state.reactNamespaceAliases &&
      source === "react" &&
      (specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier")
    ) {
      state.reactNamespaceAliases.add(specifier.local.name);
    }

    if (state.apiImports && isApiImport(source)) {
      state.apiImports.add(specifier.local.name);
    }
  }
}

function findForbiddenFetchCall(node, state, localFunctionBindings = new Map()) {
  const stack = [{ node, isRoot: true }];
  const visitedFunctions = new Set();

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    const current = currentEntry?.node;

    if (!current || typeof current !== "object") {
      continue;
    }

    if (!currentEntry.isRoot && isFunctionNode(current)) {
      continue;
    }

    if (current.type === "CallExpression") {
      const callee = unwrapExpression(current.callee);

      if (isFunctionNode(callee) && !visitedFunctions.has(callee)) {
        visitedFunctions.add(callee);
        stack.push({ node: callee.body, isRoot: true });
      }

      if (
        callee?.type === "Identifier" &&
        localFunctionBindings.has(callee.name)
      ) {
        const functionNode = localFunctionBindings.get(callee.name);

        if (functionNode && !visitedFunctions.has(functionNode)) {
          visitedFunctions.add(functionNode);
          stack.push({ node: functionNode.body, isRoot: true });
        }
      }

      if (isIdentifier(callee, "fetch")) {
        return current;
      }

      if (
        callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        isIdentifier(callee.property, "fetch") &&
        (callee.object.name === "window" || callee.object.name === "globalThis")
      ) {
        return current;
      }

      if (
        isIdentifier(callee, "axios") ||
        (callee?.type === "Identifier" && state.axiosImports.has(callee.name))
      ) {
        return current;
      }

      if (
        callee?.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        state.axiosImports.has(callee.object.name)
      ) {
        return current;
      }

      if (callee?.type === "Identifier" && state.apiImports.has(callee.name)) {
        return current;
      }

      if (
        callee?.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        state.apiImports.has(callee.object.name)
      ) {
        return current;
      }
    }

    for (const [key, value] of Object.entries(current)) {
      if (key === "parent") {
        continue;
      }

      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const item = value[index];
          if (item && typeof item === "object" && "type" in item) {
            stack.push({ node: item, isRoot: false });
          }
        }
        continue;
      }

      if (value && typeof value === "object" && "type" in value) {
        stack.push({ node: value, isRoot: false });
      }
    }
  }

  return null;
}

function findNearestAppRoot(filename) {
  let currentDirectory = path.resolve(path.dirname(filename));

  while (true) {
    if (
      existsSync(path.join(currentDirectory, "src")) &&
      existsSync(path.join(currentDirectory, "package.json"))
    ) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveLocalImportBase(source, filename) {
  if (typeof source !== "string") {
    return null;
  }

  if (source.startsWith("./") || source.startsWith("../")) {
    return path.resolve(path.dirname(filename), source);
  }

  if (source.startsWith("@/")) {
    const appRoot = findNearestAppRoot(filename);

    if (!appRoot) {
      return null;
    }

    return path.resolve(appRoot, "src", source.slice(2));
  }

  return null;
}

function getBarrelTarget(source, filename) {
  const resolvedBase = resolveLocalImportBase(source, filename);

  if (!resolvedBase) {
    return null;
  }

  if (path.basename(resolvedBase) === "index") {
    for (const extension of INDEX_FILE_EXTENSIONS) {
      const candidate = `${resolvedBase}${extension}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (!existsSync(resolvedBase)) {
    return null;
  }

  let stats;
  try {
    stats = statSync(resolvedBase);
  } catch {
    return null;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  for (const extension of INDEX_FILE_EXTENSIONS) {
    const candidate = path.join(resolvedBase, `index${extension}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isTestFilename(filename) {
  return (
    filename.includes(`${path.sep}__tests__${path.sep}`) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

function isApiModuleImport(source, filename) {
  if (typeof source !== "string") {
    return false;
  }

  if (source === "@/api" || source.startsWith("@/api/")) {
    return true;
  }

  const resolvedBase = resolveLocalImportBase(source, filename);
  const appRoot = findNearestAppRoot(filename);

  if (!resolvedBase || !appRoot) {
    return false;
  }

  const apiRoot = path.join(appRoot, "src", "api");
  const normalizedResolvedBase = path.normalize(resolvedBase);

  return (
    normalizedResolvedBase === apiRoot ||
    normalizedResolvedBase.startsWith(`${apiRoot}${path.sep}`)
  );
}

function isAllowedApiImportFilename(filename) {
  const appRoot = findNearestAppRoot(filename);

  if (!appRoot) {
    return true;
  }

  const normalizedFilename = path.resolve(filename);
  const hooksApiRoot = path.join(appRoot, "src", "hooks", "api");
  const apiRoot = path.join(appRoot, "src", "api");

  return (
    normalizedFilename.startsWith(`${hooksApiRoot}${path.sep}`) ||
    normalizedFilename.startsWith(`${apiRoot}${path.sep}`) ||
    isTestFilename(normalizedFilename)
  );
}

const frontendReactRules = {
  meta: {
    name: "frontend-react-rules",
  },
  rules: {
    "no-data-fetching-in-use-effect": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow data fetching inside useEffect; prefer React Query hooks, loaders, or explicit user actions.",
        },
        schema: [],
        messages: {
          asyncEffect:
            "Keep useEffect callbacks synchronous. Move async fetching into React Query, a loader, or an explicit event handler.",
          forbiddenFetch:
            "Do not fetch data inside useEffect. Use React Query hooks or a dedicated data-loading path instead.",
        },
      },
      create(context) {
        const state = {
          apiImports: new Set(),
          axiosImports: new Set(),
        };

        return {
          ImportDeclaration(node) {
            collectImportNames(node, state);
          },
          CallExpression(node) {
            if (!isUseEffectCall(node)) {
              return;
            }

            const callback = node.arguments[0];

            if (
              callback?.type !== "ArrowFunctionExpression" &&
              callback?.type !== "FunctionExpression"
            ) {
              return;
            }

            if (callback.async) {
              context.report({ node: callback, messageId: "asyncEffect" });
              return;
            }

            const localFunctionBindings = collectLocalFunctionBindings(callback.body);
            const forbiddenCall = findForbiddenFetchCall(
              callback.body,
              state,
              localFunctionBindings,
            );

            if (forbiddenCall) {
              context.report({
                node: forbiddenCall,
                messageId: "forbiddenFetch",
              });
            }
          },
        };
      },
    },
    "no-use-effect-aliases": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow alias and computed-member forms of React useEffect so the ban cannot be bypassed.",
        },
        schema: [],
        messages: {
          avoidUseEffect:
            "Avoid useEffect. Prefer derived state during render, event handlers, React Query or existing data hooks, and useMountEffect only for mount-only side effects.",
        },
      },
      create(context) {
        const state = {
          reactNamespaceAliases: new Set(),
          useEffectAliases: new Set(),
        };

        return {
          ImportDeclaration(node) {
            collectImportNames(node, state);
          },
          CallExpression(node) {
            const callee = unwrapExpression(node.callee);

            if (
              callee?.type === "Identifier" &&
              state.useEffectAliases.has(callee.name)
            ) {
              context.report({
                node: callee,
                messageId: "avoidUseEffect",
              });
              return;
            }

            if (callee?.type !== "MemberExpression") {
              return;
            }

            const propertyName = getStaticPropertyName(callee);

            if (
              propertyName !== "useEffect" ||
              callee.object.type !== "Identifier" ||
              !state.reactNamespaceAliases.has(callee.object.name)
            ) {
              return;
            }

            if (!callee.computed && callee.object.name === "React") {
              return;
            }

            context.report({
              node: callee,
              messageId: "avoidUseEffect",
            });
          },
        };
      },
    },
    "max-use-effects-per-function": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Warn when a component or custom hook accumulates too many useEffect hooks.",
        },
        schema: [
          {
            type: "object",
            properties: {
              max: {
                type: "integer",
                minimum: 1,
              },
            },
            additionalProperties: false,
          },
        ],
        messages: {
          tooManyEffects:
            "{{name}} declares {{count}} useEffect hooks. Split side effects into focused hooks or derive state during render when possible.",
        },
      },
      create(context) {
        const [{ max = 3 } = {}] = context.options;
        const functionStack = [];

        function enterFunction(node) {
          if (!isTrackedFunction(node)) {
            functionStack.push(null);
            return;
          }

          functionStack.push({
            count: 0,
            name: getFunctionName(node) ?? "This function",
            node,
          });
        }

        function exitFunction() {
          const current = functionStack.pop();

          if (!current || current.count <= max) {
            return;
          }

          context.report({
            node: current.node,
            messageId: "tooManyEffects",
            data: {
              count: String(current.count),
              name: current.name,
            },
          });
        }

        return {
          FunctionDeclaration: enterFunction,
          "FunctionDeclaration:exit": exitFunction,
          FunctionExpression: enterFunction,
          "FunctionExpression:exit": exitFunction,
          ArrowFunctionExpression: enterFunction,
          "ArrowFunctionExpression:exit": exitFunction,
          CallExpression(node) {
            const current = functionStack[functionStack.length - 1];

            if (!current || !isUseEffectCall(node)) {
              return;
            }

            current.count += 1;
          },
        };
      },
    },
    "no-barrel-exports": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Disallow wildcard barrel exports; keep module boundaries explicit for Fast Refresh.",
        },
        schema: [],
        messages: {
          noBarrelExport:
            "Avoid barrel exports. Export from the concrete module file instead of re-exporting {{source}}.",
        },
      },
      create(context) {
        return {
          ExportAllDeclaration(node) {
            context.report({
              node,
              messageId: "noBarrelExport",
              data: {
                source: node.source.value,
              },
            });
          },
        };
      },
    },
    "no-barrel-imports": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Disallow imports that resolve through local index barrels; import the concrete file instead.",
        },
        schema: [],
        messages: {
          noBarrelImport:
            'Avoid barrel imports. "{{source}}" resolves through {{target}}; import the concrete module file instead.',
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            const source = node.source.value;

            if (typeof source !== "string") {
              return;
            }

            const barrelTarget = getBarrelTarget(source, context.filename);

            if (!barrelTarget) {
              return;
            }

            context.report({
              node: node.source,
              messageId: "noBarrelImport",
              data: {
                source,
                target: path.relative(process.cwd(), barrelTarget),
              },
            });
          },
        };
      },
    },
    "api-imports-only-in-hooks": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Restrict direct @/api/* imports to src/hooks/api/** so components consume React Query hooks instead.",
        },
        schema: [],
        messages: {
          apiImportOutsideHooks:
            "Import {{source}} from src/hooks/api/** instead of importing @/api/* directly here. Wrap the API call in a React Query hook and consume that hook from UI code.",
        },
      },
      create(context) {
        if (isAllowedApiImportFilename(context.filename)) {
          return {};
        }

        return {
          ImportDeclaration(node) {
            const source = node.source.value;

            if (
              !isApiModuleImport(source, context.filename) ||
              !hasValueImportSpecifier(node)
            ) {
              return;
            }

            context.report({
              node: node.source,
              messageId: "apiImportOutsideHooks",
              data: {
                source,
              },
            });
          },
        };
      },
    },
    "no-namespace-imports-except-react": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            'Disallow namespace imports except for import * as React from "react".',
        },
        schema: [],
        messages: {
          noNamespaceImport:
            'Avoid namespace imports like {{localName}} from {{source}}. Use named imports instead. The only allowed namespace import is `import * as React from "react"`.',
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            const source = node.source.value;

            if (typeof source !== "string") {
              return;
            }

            for (const specifier of node.specifiers) {
              if (specifier.type !== "ImportNamespaceSpecifier") {
                continue;
              }

              const isAllowedReactNamespaceImport =
                source === "react" && specifier.local.name === "React";

              if (isAllowedReactNamespaceImport) {
                continue;
              }

              context.report({
                node: specifier,
                messageId: "noNamespaceImport",
                data: {
                  localName: specifier.local.name,
                  source,
                },
              });
            }
          },
        };
      },
    },
  },
};

export default frontendReactRules;
