import { create } from "zustand";
import { CONTAINER_NODE_TYPES, createDocumentNode, createEmptyDocument, createId, DOCUMENT_PRESETS, PAPER_PRESETS } from "@/lib/document/schema";
import { replaceDocumentMatches } from "@/lib/document/textSearch";
import { validateDocument } from "@/lib/document/validation";

function touch(document, changes) {
  return { ...document, ...changes, updatedAt: new Date().toISOString() };
}

function commitDocument(state, document, changes = {}) {
  const now = Date.now();
  const previous = { document: state.document, selectedNodeId: state.selectedNodeId };
  const last = state.past.at(-1);
  const mergeWithPrevious = last?.document?.id === state.document?.id && now - state.lastHistoryAt < 850;
  const past = mergeWithPrevious ? state.past : [...state.past, previous].slice(-50);
  return { document, ...changes, past, future: [], lastHistoryAt: now };
}

function updateNodeInTree(nodes, nodeId, update) {
  return nodes.map((node) => {
    if (node.id === nodeId) return update(node);
    if (!node.children) return node;
    const children = updateNodeInTree(node.children, nodeId, update);
    return children === node.children ? node : { ...node, children };
  });
}

function migrateLegacyHangingNodes(nodes) {
  let changed = false;
  const next = [];
  for (const original of nodes ?? []) {
    let node = original;
    if (original.children?.length) {
      const nested = migrateLegacyHangingNodes(original.children);
      if (nested.changed) {
        node = { ...original, children: nested.nodes };
        changed = true;
      }
    }
    if (node.type === "paragraph" && node.hangingList?.listId) {
      let hostIndex = -1;
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index].type === "paragraph" && !next[index].hangingList) { hostIndex = index; break; }
      }
      if (hostIndex >= 0) {
        const host = { ...next[hostIndex] };
        next[hostIndex] = host;
        const list = node.hangingList;
        const sameList = host.hangingSettings?.legacyListId === list.listId;
        const item = { id: node.id, text: node.title || "" };
        if (!host.hangingItems?.some((entry) => entry.id === item.id)) host.hangingItems = [...(sameList ? host.hangingItems ?? [] : []), item];
        host.hangingSettings = {
          legacyListId: list.listId,
          format: list.format ?? "decimal",
          indentCm: Number(list.indentCm) || 0.65,
          hangingCm: Number(list.hangingCm) || 0.6,
        };
        changed = true;
        continue;
      }
    }
    next.push(node);
  }
  return { nodes: changed ? next : nodes, changed };
}

function removeNodeFromTree(nodes, nodeId) {
  let removed = null;
  const remaining = [];
  for (const node of nodes) {
    if (node.id === nodeId) {
      removed = node;
      continue;
    }
    if (node.children) {
      const result = removeNodeFromTree(node.children, nodeId);
      if (result.removed) removed = result.removed;
      remaining.push(result.removed ? { ...node, children: result.nodes } : node);
    } else {
      remaining.push(node);
    }
  }
  return { nodes: remaining, removed };
}

function removeNodesFromTree(nodes, nodeIds, removedIds = new Set()) {
  const remaining = [];
  let changed = false;
  for (const node of nodes ?? []) {
    if (nodeIds.has(node.id)) {
      const collect = (item) => { removedIds.add(item.id); (item.children ?? []).forEach(collect); };
      collect(node);
      changed = true;
      continue;
    }
    if (node.children?.length) {
      const result = removeNodesFromTree(node.children, nodeIds, removedIds);
      remaining.push(result.changed ? { ...node, children: result.nodes } : node);
      changed ||= result.changed;
    } else remaining.push(node);
  }
  return { nodes: changed ? remaining : nodes, removedIds, changed };
}

function splitParagraphInTree(nodes, nodeId, firstContent, secondContent) {
  const next = [];
  const list = nodes ?? [];
  for (let index = 0; index < list.length; index += 1) {
    const node = list[index];
    if (node.id === nodeId && node.type === "paragraph") {
      const updated = { ...node, content: firstContent };
      const inserted = createDocumentNode("paragraph", { title: "Paragraf baru", content: secondContent });
      next.push(updated, inserted);
      return { nodes: [...next, ...list.slice(index + 1)], inserted, found: true };
    }
    if (node.children?.length) {
      const result = splitParagraphInTree(node.children, nodeId, firstContent, secondContent);
      if (result.found) {
        next.push({ ...node, children: result.nodes }, ...list.slice(index + 1));
        return { nodes: next, inserted: result.inserted, found: true };
      }
    }
    next.push(node);
  }
  return { nodes, inserted: null, found: false };
}

function containsNode(node, targetId) {
  return node.id === targetId || (node.children ?? []).some((child) => containsNode(child, targetId));
}

function cloneNodeWithNewIds(node) {
  return {
    ...structuredClone(node),
    id: createId(),
    ...(Array.isArray(node.children) ? { children: node.children.map(cloneNodeWithNewIds) } : {}),
  };
}

function insertNode(nodes, parentId, index, node) {
  if (parentId === null) {
    const next = [...nodes];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return { nodes: next, inserted: true };
  }

  let inserted = false;
  const next = nodes.map((candidate) => {
    if (candidate.id === parentId && Array.isArray(candidate.children)) {
      const children = [...candidate.children];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
      inserted = true;
      return { ...candidate, children };
    }
    if (!candidate.children || inserted) return candidate;
    const result = insertNode(candidate.children, parentId, index, node);
    if (result.inserted) {
      inserted = true;
      return { ...candidate, children: result.nodes };
    }
    return candidate;
  });
  return { nodes: next, inserted };
}

function insertAfterNodeInTree(nodes, targetId, node) {
  const list = nodes ?? [];
  const next = [];
  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index];
    if (candidate.id === targetId) {
      next.push(candidate, node, ...list.slice(index + 1));
      return { nodes: next, inserted: true };
    }
    if (candidate.children?.length) {
      const result = insertAfterNodeInTree(candidate.children, targetId, node);
      if (result.inserted) {
        next.push({ ...candidate, children: result.nodes }, ...list.slice(index + 1));
        return { nodes: next, inserted: true };
      }
    }
    next.push(candidate);
  }
  return { nodes: list, inserted: false };
}

function findNodeLocation(nodes, targetId, parentId = null) {
  const list = nodes ?? [];
  const index = list.findIndex((node) => node.id === targetId);
  if (index >= 0) return { parentId, index, count: list.length };
  for (const node of list) {
    if (!node.children?.length) continue;
    const nested = findNodeLocation(node.children, targetId, node.id);
    if (nested) return nested;
  }
  return null;
}

export const useDocumentStore = create((set, get) => ({
  document: null,
  selectedNodeId: null,
  validationErrors: [],
  past: [],
  future: [],
  lastHistoryAt: 0,

  createDocument: (title) => {
    const document = createEmptyDocument(undefined, title);
    set({ document, selectedNodeId: null, validationErrors: [], past: [], future: [], lastHistoryAt: 0 });
    return document;
  },

  loadDocument: (document) => {
    const migration = migrateLegacyHangingNodes(document.sections);
    const normalizedDocument = migration.changed ? { ...document, sections: migration.nodes } : document;
    const result = validateDocument(normalizedDocument);
    if (!result.valid) {
      set({ validationErrors: result.errors });
      return result;
    }
    set({ document: normalizedDocument, selectedNodeId: null, validationErrors: [], past: [], future: [], lastHistoryAt: 0 });
    return result;
  },

  clearDocument: () => set({ document: null, selectedNodeId: null, validationErrors: [], past: [], future: [], lastHistoryAt: 0 }),

  setDocumentTitle: (title) => set((state) => state.document
    ? commitDocument(state, touch(state.document, { title: String(title) }))
    : state),

  setPreset: (preset, customConfiguration = null) => set((state) => {
    if (!state.document) return state;
    const configuration = customConfiguration ?? DOCUMENT_PRESETS[preset];
    if (!configuration) return commitDocument(state, touch(state.document, { preset }));
    const paper = typeof configuration.paper === "string"
      ? { size: configuration.paper, ...PAPER_PRESETS[configuration.paper] }
      : { ...configuration.paper };
    return commitDocument(state, touch(state.document, {
      preset,
      paper,
      margins: { ...configuration.margins },
      ...(configuration.typography ? { typography: { ...state.document.typography, ...configuration.typography } } : {}),
      ...(configuration.paragraph ? { paragraph: { ...state.document.paragraph, ...configuration.paragraph } } : {}),
      ...(configuration.outlineStyles ? { outlineStyles: { ...state.document.outlineStyles, ...configuration.outlineStyles } } : {}),
      ...(configuration.pageNumbering ? { pageNumbering: { ...state.document.pageNumbering, ...configuration.pageNumbering } } : {}),
    }));
  }),

  updateSettings: (group, changes) => {
    const allowedGroups = ["paper", "margins", "typography", "paragraph", "outlineStyles", "frontMatterProfile", "pageNumbering"];
    if (!allowedGroups.includes(group)) return;
    set((state) => state.document
      ? commitDocument(state, touch(state.document, {
        [group]: { ...state.document[group], ...changes },
        ...(["paper", "margins"].includes(group) ? { preset: "Custom" } : {}),
      }))
      : state);
  },

  updateReferences: (references) => set((state) => state.document
    ? commitDocument(state, touch(state.document, { references: Array.isArray(references) ? references : [] }))
    : state),

  setCitationStyle: (citationStyle) => set((state) => state.document
    ? commitDocument(state, touch(state.document, { citationStyle }))
    : state),

  setDocumentKind: (documentKind) => set((state) => state.document
    ? commitDocument(state, touch(state.document, { documentKind }))
    : state),

  addNode: (type, values = {}, parentId = null) => {
    const node = createDocumentNode(type, values);
    set((state) => {
      if (!state.document) return state;
      const result = insertNode(state.document.sections, parentId, Number.MAX_SAFE_INTEGER, node);
      if (!result.inserted) return state;
      return commitDocument(state, touch(state.document, { sections: result.nodes }), { selectedNodeId: node.id });
    });
    return node;
  },

  addNodes: (nodes, parentId = null) => {
    const prepared = Array.isArray(nodes) ? nodes : [];
    if (!prepared.length) return [];
    set((state) => {
      if (!state.document) return state;
      let sections = state.document.sections;
      let inserted = false;
      prepared.forEach((node) => {
        const result = insertNode(sections, parentId, Number.MAX_SAFE_INTEGER, node);
        if (result.inserted) { sections = result.nodes; inserted = true; }
      });
      return inserted ? commitDocument(state, touch(state.document, { sections }), { selectedNodeId: prepared.at(-1).id }) : state;
    });
    return prepared;
  },

  addNodeAtSelection: (type, values = {}, targetId = null) => {
    const node = createDocumentNode(type, values);
    set((state) => {
      if (!state.document) return state;
      const target = targetId ? findNode(state.document.sections, targetId) : null;
      const result = target && CONTAINER_NODE_TYPES.includes(target.type)
        ? insertNode(state.document.sections, target.id, Number.MAX_SAFE_INTEGER, node)
        : target
          ? insertAfterNodeInTree(state.document.sections, target.id, node)
          : insertNode(state.document.sections, null, Number.MAX_SAFE_INTEGER, node);
      if (!result.inserted) return state;
      return commitDocument(state, touch(state.document, { sections: result.nodes }), { selectedNodeId: node.id });
    });
    return node;
  },

  duplicateNode: (nodeId) => {
    let duplicated = null;
    set((state) => {
      if (!state.document) return state;
      const source = findNode(state.document.sections, nodeId);
      if (!source) return state;
      duplicated = cloneNodeWithNewIds(source);
      const result = insertAfterNodeInTree(state.document.sections, nodeId, duplicated);
      if (!result.inserted) {
        duplicated = null;
        return state;
      }
      return commitDocument(state, touch(state.document, { sections: result.nodes }), { selectedNodeId: duplicated.id });
    });
    return duplicated;
  },

  replaceDocumentText: (query, replacement, options = {}) => {
    let replacedCount = 0;
    set((state) => {
      if (!state.document) return state;
      const result = replaceDocumentMatches(state.document, query, replacement, options);
      replacedCount = result.count;
      if (!replacedCount) return state;
      return commitDocument(state, touch(state.document, { sections: result.document.sections }));
    });
    return replacedCount;
  },

  updateNode: (nodeId, changes) => set((state) => {
    if (!state.document) return state;
    return commitDocument(state, touch(state.document, {
      sections: updateNodeInTree(state.document.sections, nodeId, (node) => ({ ...node, ...changes, id: node.id, type: node.type })),
    }));
  }),

  splitParagraph: (nodeId, firstContent, secondContent) => {
    let inserted = null;
    set((state) => {
      if (!state.document) return state;
      const result = splitParagraphInTree(state.document.sections, nodeId, firstContent, secondContent);
      if (!result.found) return state;
      inserted = result.inserted;
      return commitDocument(state, touch(state.document, { sections: result.nodes }), { selectedNodeId: inserted.id });
    });
    return inserted;
  },

  removeNode: (nodeId) => set((state) => {
    if (!state.document) return state;
    const result = removeNodeFromTree(state.document.sections, nodeId);
    const selectedWasRemoved = result.removed && state.selectedNodeId && containsNode(result.removed, state.selectedNodeId);
    if (!result.removed) return state;
    return commitDocument(state, touch(state.document, { sections: result.nodes }), {
      selectedNodeId: selectedWasRemoved ? null : state.selectedNodeId,
    });
  }),

  removeNodes: (nodeIds) => set((state) => {
    if (!state.document || !nodeIds?.length) return state;
    const ids = new Set(nodeIds);
    const result = removeNodesFromTree(state.document.sections, ids);
    if (!result.changed) return state;
    return commitDocument(state, touch(state.document, { sections: result.nodes }), {
      selectedNodeId: result.removedIds.has(state.selectedNodeId) ? null : state.selectedNodeId,
    });
  }),

  moveNode: (nodeId, targetParentId = null, targetIndex = Number.MAX_SAFE_INTEGER) => set((state) => {
    if (!state.document || nodeId === targetParentId) return state;
    const source = findNode(state.document.sections, nodeId);
    if (!source || (targetParentId && containsNode(source, targetParentId))) return state;
    const removed = removeNodeFromTree(state.document.sections, nodeId);
    if (!removed.removed) return state;
    const inserted = insertNode(removed.nodes, targetParentId, targetIndex, removed.removed);
    if (!inserted.inserted) return state;
    return commitDocument(state, touch(state.document, { sections: inserted.nodes }));
  }),

  moveNodeByOffset: (nodeId, offset) => {
    const document = get().document;
    if (!document || ![-1, 1].includes(offset)) return;
    const location = findNodeLocation(document.sections, nodeId);
    if (!location) return;
    const targetIndex = location.index + offset;
    if (targetIndex < 0 || targetIndex >= location.count) return;
    get().moveNode(nodeId, location.parentId, targetIndex);
  },

  undo: () => set((state) => {
    if (!state.document || state.past.length === 0) return state;
    const snapshot = state.past.at(-1);
    const selectedNodeId = snapshot.selectedNodeId && findNode(snapshot.document.sections, snapshot.selectedNodeId)
      ? snapshot.selectedNodeId : null;
    return {
      document: snapshot.document,
      selectedNodeId,
      validationErrors: [],
      past: state.past.slice(0, -1),
      future: [{ document: state.document, selectedNodeId: state.selectedNodeId }, ...state.future].slice(0, 50),
      lastHistoryAt: 0,
    };
  }),

  redo: () => set((state) => {
    if (!state.document || state.future.length === 0) return state;
    const [snapshot, ...future] = state.future;
    const selectedNodeId = snapshot.selectedNodeId && findNode(snapshot.document.sections, snapshot.selectedNodeId)
      ? snapshot.selectedNodeId : null;
    return {
      document: snapshot.document,
      selectedNodeId,
      validationErrors: [],
      past: [...state.past, { document: state.document, selectedNodeId: state.selectedNodeId }].slice(-50),
      future,
      lastHistoryAt: 0,
    };
  }),

  selectNode: (selectedNodeId) => set((state) => ({
    selectedNodeId: selectedNodeId === null || (state.document && findNode(state.document.sections, selectedNodeId))
      ? selectedNodeId
      : state.selectedNodeId,
  })),

  validateCurrentDocument: () => {
    const document = get().document;
    const result = validateDocument(document);
    set({ validationErrors: result.errors });
    return result;
  },
}));

export function findNode(nodes, nodeId) {
  for (const node of nodes ?? []) {
    if (node.id === nodeId) return node;
    const nested = findNode(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}
