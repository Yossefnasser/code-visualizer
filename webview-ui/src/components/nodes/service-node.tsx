import { Position, type Node, type NodeProps } from '@xyflow/react';

import { BaseHandle } from '@/components/base-handle';
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
} from '@/components/base-node';
import type { ArchitectureNodeData } from '@/types/architecture';

export type ServiceFlowNode = Node<ArchitectureNodeData, 'service'>;

interface ServiceDetails {
  module?: string;
  function?: string;
}

export function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const details = (data.node.details ?? {}) as ServiceDetails;

  return (
    <BaseNode className="w-56">
      <BaseHandle type="target" position={Position.Left} />
      <BaseHandle type="source" position={Position.Right} />
      <BaseNodeHeader className="border-b p-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
          service
        </span>
        <BaseNodeHeaderTitle className="truncate font-mono text-xs" title={data.node.label}>
          {data.node.label}
        </BaseNodeHeaderTitle>
      </BaseNodeHeader>
      {details.module ? (
        <BaseNodeContent className="p-2">
          <p className="truncate font-mono text-xs text-muted-foreground" title={details.module}>
            {details.module}
          </p>
        </BaseNodeContent>
      ) : null}
    </BaseNode>
  );
}
