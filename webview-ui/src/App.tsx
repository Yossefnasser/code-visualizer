import { useCallback, useMemo, useState } from 'react';
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
import { DetailsPanel } from '@/components/panels/details-panel';
import { MOCK_DATA_NOTE, MOCK_GRAPH } from '@/fixtures/mock-architecture';
import type { ArchitectureGraph } from '@/types/architecture';

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

function buildFlowEdges(graph: ArchitectureGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: `${edge.type} (${edge.status})`,
  }));
}

export default function App() {
  const [nodes, setNodes] = useState<FlowNode[]>(() => buildFlowNodes(MOCK_GRAPH));
  const [edges, setEdges] = useState<Edge[]>(() => buildFlowEdges(MOCK_GRAPH));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => MOCK_GRAPH.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId],
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
        {/* Clearly labels the rendered graph as fixture/mock data. */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-amber-500 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 shadow-sm">
          {MOCK_DATA_NOTE}
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

