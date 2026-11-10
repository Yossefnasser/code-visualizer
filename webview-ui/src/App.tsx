import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  DatabaseModelNode,
  type DatabaseModelFlowNode,
} from '@/components/nodes/database-model-node';
import { EndpointNode, type EndpointFlowNode } from '@/components/nodes/endpoint-node';
import { ServiceNode, type ServiceFlowNode } from '@/components/nodes/service-node';
import type { ArchitectureGraph, ArchitectureNode } from '@/types/architecture';
import { DetailsPanel } from '@/components/panels/details-panel';
import { MOCK_DATA_NOTE, MOCK_GRAPH } from '@/fixtures/mock-architecture';

type FlowNode = EndpointFlowNode | ServiceFlowNode | DatabaseModelFlowNode;

const nodeTypes = {
  endpoint: EndpointNode,
  service: ServiceNode,
  database_model: DatabaseModelNode,
};

// Simple deterministic column layout: endpoints, then services, then database
// models. Real layout logic arrives with later milestones.
const COLUMN_BY_NODE_TYPE: Record<string, number> = {
  endpoint: 0,
  service: 1,
  database_model: 2,
};

/**
 * Edge types shown in the prototype. Semantic relationship types (`calls`,
 * `uses`, `uses_model`, `reads`, `writes`) are suppressed for display until
 * `FindingValidator` exists: AI-only relationships remain `inferred` and must
 * not be presented as part of the graph. Factual/deterministic types
 * (`route_handler`, `orm_relationship`, `imports`) are shown.
 */
const DISPLAYABLE_EDGE_TYPES = new Set(['route_handler', 'orm_relationship', 'imports']);

function buildFlowNodes(graph: ArchitectureGraph): FlowNode[] {
  const rowByType: Record<string, number> = {};
  const flowNodes: FlowNode[] = [];

  for (const node of graph.nodes) {
    const column = COLUMN_BY_NODE_TYPE[node.type];
    if (column === undefined) {
      // Unknown node types are skipped until dedicated renderers exist.
      continue;
    }
    const row = rowByType[node.type] ?? 0;
    rowByType[node.type] = row + 1;
    flowNodes.push({
      id: node.id,
      type: node.type,
      position: { x: column * 300, y: row * 180 },
      data: { node },
    } as FlowNode);
  }

  return flowNodes;
}

function buildFlowEdges(graph: ArchitectureGraph, renderedNodeIds: Set<string>): Edge[] {
  return graph.edges
    .filter((edge) => DISPLAYABLE_EDGE_TYPES.has(edge.type))
    .filter((edge) => renderedNodeIds.has(edge.source) && renderedNodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: originSuffix(edge),
    }));
}

function originSuffix(edge: ArchitectureGraph['edges'][number]): string {
  const base = `${edge.type} (${edge.status}`;
  return edge.origin ? `${base}, ${edge.origin})` : `${base})`;
}

function countSuppressedEdges(graph: ArchitectureGraph, renderedNodeIds: Set<string>): number {
  return graph.edges.filter(
    (edge) =>
      !DISPLAYABLE_EDGE_TYPES.has(edge.type) &&
      renderedNodeIds.has(edge.source) &&
      renderedNodeIds.has(edge.target),
  ).length;
}

/** Minimal VS Code webview API surface used by this component. */
type VsCodeApi = {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

interface HostMessage {
  type: string;
  graph?: ArchitectureGraph;
  source?: string;
  error?: string;
}

export default function App() {
  const [graph, setGraph] = useState<ArchitectureGraph>(MOCK_GRAPH);
  const [nodes, setNodes] = useState<FlowNode[]>(() => buildFlowNodes(MOCK_GRAPH));
  const [edges, setEdges] = useState<Edge[]>(() => buildFlowEdges(MOCK_GRAPH, new Set(MOCK_GRAPH.nodes.map((n) => n.id))));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The banner shows what is actually displayed: the offline fixture, or real
  // contract data sent by the extension host once the webview is ready.
  const [dataNote, setDataNote] = useState<string>(MOCK_DATA_NOTE);
  const [suppressedEdges, setSuppressedEdges] = useState(0);

  const vscodeApi = useMemo(() => {
    try {
      return window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;
    } catch {
      // acquireVsCodeApi throws if called twice (e.g. React StrictMode double
      // mount); reuse is impossible, so we assume the first call succeeded.
      return null;
    }
  }, []);

  const applyGraph = useCallback((next: ArchitectureGraph, note: string) => {
    setGraph(next);
    const rendered = buildFlowNodes(next);
    const renderedIds = new Set(rendered.map((node) => node.id));
    setNodes(rendered);
    setEdges(buildFlowEdges(next, renderedIds));
    setSuppressedEdges(countSuppressedEdges(next, renderedIds));
    setDataNote(note);
    setSelectedNodeId(null);
  }, []);

  useEffect(() => {
    if (!vscodeApi) {
      // Opened outside VS Code (e.g. "npm run dev" in webview-ui): fall back
      // to the clearly labeled fixture graph.
      return;
    }
    vscodeApi.postMessage({ type: 'webviewReady' });
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'architectureGraph' && message.graph) {
        const note = message.source
          ? `Contract data: ${message.source}`
          : 'Contract data from the extension host.';
        applyGraph(message.graph, note);
      } else if (message.type === 'analysisError') {
        setDataNote(message.error ?? 'Analysis failed.');
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [vscodeApi, applyGraph]);

  const selectedNode: ArchitectureNode | null = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );

  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

  return (
    <div className="flex h-dvh w-full">
      <div className="relative flex-1">
        {/* Clearly labels what is rendered: fixture data vs. contract data. */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-amber-500 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 shadow-sm">
          {dataNote}
          {graph !== MOCK_GRAPH && suppressedEdges > 0 ? (
            <div className="font-normal">
              {suppressedEdges} semantic relationship(s) suppressed until FindingValidator exists.
            </div>
          ) : null}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
        />
      </div>
      <DetailsPanel node={selectedNode} />
    </div>
  );
}
