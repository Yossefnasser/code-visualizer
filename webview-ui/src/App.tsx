import { useState, useCallback } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DatabaseSchemaNode,
  DatabaseSchemaNodeHeader,
  DatabaseSchemaNodeBody,
  DatabaseSchemaTableRow,
  DatabaseSchemaTableCell,
} from '@/components/database-schema-node';

type SchemaColumn = {
  name: string;
  type: string;
};

export type SchemaTableData = {
  name: string;
  columns: SchemaColumn[];
};

type SchemaTableNodeType = Node<SchemaTableData, 'schemaTable'>;

function SchemaTableNode({ data }: NodeProps<SchemaTableNodeType>) {
  return (
    <DatabaseSchemaNode className="w-56">
      <DatabaseSchemaNodeHeader>{data.name}</DatabaseSchemaNodeHeader>
      <DatabaseSchemaNodeBody>
        {data.columns.map((column) => (
          <DatabaseSchemaTableRow key={column.name}>
            <DatabaseSchemaTableCell>{column.name}</DatabaseSchemaTableCell>
            <DatabaseSchemaTableCell className="text-right text-muted-foreground">
              {column.type}
            </DatabaseSchemaTableCell>
          </DatabaseSchemaTableRow>
        ))}
      </DatabaseSchemaNodeBody>
    </DatabaseSchemaNode>
  );
}

const nodeTypes = {
  schemaTable: SchemaTableNode,
};

const initialNodes: SchemaTableNodeType[] = [
  {
    id: 'n1',
    type: 'schemaTable',
    position: { x: 0, y: 0 },
    data: {
      name: 'users',
      columns: [
        { name: 'id', type: 'int' },
        { name: 'email', type: 'text' },
        { name: 'created_at', type: 'timestamp' },
      ],
    },
  },
  {
    id: 'n2',
    type: 'schemaTable',
    position: { x: 300, y: 150 },
    data: {
      name: 'orders',
      columns: [
        { name: 'id', type: 'int' },
        { name: 'user_id', type: 'int' },
        { name: 'total', type: 'numeric' },
      ],
    },
  },
];
const initialEdges: Edge[] = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];

export default function App() {
  const [nodes, setNodes] = useState<SchemaTableNodeType[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onNodesChange: OnNodesChange<SchemaTableNodeType> = useCallback(
    (changes) =>
      setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) =>
      setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      />
    </div>
  );
}
