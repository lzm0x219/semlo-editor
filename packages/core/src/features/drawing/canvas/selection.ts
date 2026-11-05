import type { CanvasData } from "./model";
import type { CanvasViewState } from "./state";

export function createCanvasSelection(state: Pick<CanvasViewState, "selected" | "selectedEdge">) {
  const selectedIds = new Set<string>();
  const selectedEdgeIds = new Set<string>();
  const selectedStrokeIds = new Set<string>();

  const shapeGroup = (data: CanvasData, id: string) =>
    data.groups?.find((group) => group.members.includes(id))?.members ?? [id];
  const selectOnly = (id: string | null) => {
    selectedIds.clear();
    if (id) selectedIds.add(id);
    state.selected = id;
  };
  const selectShapeGroup = (data: CanvasData, id: string) => {
    const group = data.groups?.find((entry) => entry.members.includes(id));
    selectedIds.clear();
    selectedStrokeIds.clear();
    selectedEdgeIds.clear();
    for (const member of shapeGroup(data, id)) selectedIds.add(member);
    for (const stroke of group?.strokes ?? []) selectedStrokeIds.add(stroke);
    for (const edge of group?.edges ?? []) selectedEdgeIds.add(edge);
    state.selectedEdge = selectedEdgeIds.values().next().value ?? null;
    state.selected = id;
  };
  const selectStrokeGroup = (data: CanvasData, id: string) => {
    const group = data.groups?.find((entry) => entry.strokes?.includes(id));
    selectedIds.clear();
    selectedStrokeIds.clear();
    selectedEdgeIds.clear();
    for (const member of group?.members ?? []) selectedIds.add(member);
    for (const member of group?.strokes ?? [id]) selectedStrokeIds.add(member);
    for (const edge of group?.edges ?? []) selectedEdgeIds.add(edge);
    state.selectedEdge = selectedEdgeIds.values().next().value ?? null;
    state.selected = selectedIds.values().next().value ?? null;
  };
  const selectEdgeGroup = (data: CanvasData, id: string) => {
    const group = data.groups?.find((entry) => entry.edges?.includes(id));
    selectedIds.clear();
    selectedStrokeIds.clear();
    selectedEdgeIds.clear();
    for (const member of group?.members ?? []) selectedIds.add(member);
    for (const member of group?.strokes ?? []) selectedStrokeIds.add(member);
    for (const member of group?.edges ?? [id]) selectedEdgeIds.add(member);
    state.selected = selectedIds.values().next().value ?? null;
    state.selectedEdge = id;
  };

  const updateMembers = (selected: Set<string>, members: string[], remove: boolean) => {
    for (const member of members) {
      if (remove) selected.delete(member);
      else selected.add(member);
    }
  };
  const toggleShapeGroup = (data: CanvasData, id: string, extend: boolean) => {
    if (extend) {
      const members = shapeGroup(data, id);
      const remove = members.every((member) => selectedIds.has(member));
      const group = data.groups?.find((entry) => entry.members.includes(id));
      updateMembers(selectedIds, members, remove);
      updateMembers(selectedStrokeIds, group?.strokes ?? [], remove);
      updateMembers(selectedEdgeIds, group?.edges ?? [], remove);
      state.selectedEdge = selectedEdgeIds.values().next().value ?? null;
      state.selected = selectedIds.has(id) ? id : (selectedIds.values().next().value ?? null);
    } else {
      selectShapeGroup(data, id);
    }
  };
  const toggleEdgeGroup = (data: CanvasData, id: string, extend: boolean) => {
    if (extend) {
      const group = data.groups?.find((entry) => entry.edges?.includes(id));
      const edges = group?.edges ?? [id];
      const remove =
        edges.every((member) => selectedEdgeIds.has(member)) &&
        (group?.members ?? []).every((member) => selectedIds.has(member)) &&
        (group?.strokes ?? []).every((member) => selectedStrokeIds.has(member));
      updateMembers(selectedEdgeIds, edges, remove);
      updateMembers(selectedIds, group?.members ?? [], remove);
      updateMembers(selectedStrokeIds, group?.strokes ?? [], remove);
      state.selected = selectedIds.values().next().value ?? null;
    } else {
      selectEdgeGroup(data, id);
    }
    state.selectedEdge = selectedEdgeIds.has(id) ? id : (selectedEdgeIds.values().next().value ?? null);
  };
  const toggleStrokeGroup = (data: CanvasData, id: string, extend: boolean) => {
    if (extend) {
      const group = data.groups?.find((entry) => entry.strokes?.includes(id));
      const strokes = group?.strokes ?? [id];
      const remove =
        strokes.every((member) => selectedStrokeIds.has(member)) &&
        (group?.members ?? []).every((member) => selectedIds.has(member)) &&
        (group?.edges ?? []).every((member) => selectedEdgeIds.has(member));
      updateMembers(selectedStrokeIds, strokes, remove);
      updateMembers(selectedIds, group?.members ?? [], remove);
      updateMembers(selectedEdgeIds, group?.edges ?? [], remove);
      state.selectedEdge = selectedEdgeIds.values().next().value ?? null;
      state.selected = selectedIds.values().next().value ?? null;
    } else {
      selectStrokeGroup(data, id);
    }
  };
  const retain = (data: CanvasData) => {
    for (const id of selectedIds) if (!data.shapes.some((shape) => shape.id === id)) selectedIds.delete(id);
    if (state.selected && !selectedIds.has(state.selected)) state.selected = selectedIds.values().next().value ?? null;
    for (const id of selectedEdgeIds) if (!data.edges.some((edge) => edge.id === id)) selectedEdgeIds.delete(id);
    if (state.selectedEdge && !selectedEdgeIds.has(state.selectedEdge))
      state.selectedEdge = selectedEdgeIds.values().next().value ?? null;
    for (const id of selectedStrokeIds)
      if (!(data.strokes ?? []).some((stroke) => stroke.id === id)) selectedStrokeIds.delete(id);
  };

  return {
    selectedIds,
    selectedEdgeIds,
    selectedStrokeIds,
    shapeGroup,
    selectOnly,
    selectShapeGroup,
    selectStrokeGroup,
    selectEdgeGroup,
    toggleShapeGroup,
    toggleEdgeGroup,
    toggleStrokeGroup,
    retain,
  };
}

export type CanvasSelection = ReturnType<typeof createCanvasSelection>;
