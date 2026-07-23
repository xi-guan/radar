import { BaseEdge, getSmoothStepPath, Position, type Edge, type EdgeProps } from '@xyflow/react'

// Fan-in/fan-out edges share their middle segments, so the default midpoint
// labels from parallel flows pile up into one unreadable stack. This edge
// renders the label on the stub next to the less-crowded endpoint instead
// (side picked per edge by assignEdgeLabelSides below).
const EDGE_LABEL_OFFSET = 48

function edgeLabelPoint(x: number, y: number, position: Position): { x: number; y: number } {
  switch (position) {
    case Position.Left:
      return { x: x - EDGE_LABEL_OFFSET, y }
    case Position.Right:
      return { x: x + EDGE_LABEL_OFFSET, y }
    case Position.Top:
      return { x, y: y - EDGE_LABEL_OFFSET }
    case Position.Bottom:
      return { x, y: y + EDGE_LABEL_OFFSET }
  }
}

function TrafficFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  interactionWidth,
  label,
  labelStyle,
  labelBgStyle,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const labelPoint =
    data?.labelSide === 'target'
      ? edgeLabelPoint(targetX, targetY, targetPosition)
      : edgeLabelPoint(sourceX, sourceY, sourcePosition)

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={style}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      label={label}
      labelX={labelPoint.x}
      labelY={labelPoint.y}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
    />
  )
}

export const trafficEdgeTypes = {
  trafficFlow: TrafficFlowEdge,
}

export function assignEdgeLabelSides(edges: Edge[]): void {
  const outDegree = new Map<string, number>()
  const inDegree = new Map<string, number>()
  edges.forEach((e) => {
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  })
  edges.forEach((e) => {
    e.data = {
      labelSide: (outDegree.get(e.source) ?? 0) <= (inDegree.get(e.target) ?? 0) ? 'source' : 'target',
    }
  })
}
