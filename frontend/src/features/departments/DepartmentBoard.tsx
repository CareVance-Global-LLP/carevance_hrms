import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderPlus,
  MoreVertical,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  canManagePerson,
  cardId,
  describeBreakdown,
  dropZoneId,
  getInitials,
  parseDropZoneId,
  roleAvatarStyle,
  roleLabel,
  roleTier,
  tierBreakdown,
  ROLE_TIER_LABEL,
  type BoardColumn,
  type DeptInsight,
  type PersonCard,
  type Placement,
  type TeamGroup,
} from './departmentUtils';

/* ────────────────────────────────────────────────────────────────
   Person card
   ──────────────────────────────────────────────────────────────── */

interface PersonMenuProps {
  card: PersonCard;
  departments: DeptInsight[];
  onMove: (card: PersonCard, to: Placement) => void;
  onRemove: (card: PersonCard) => void;
}

/*
  Dragging is the fast path, but it is not the only one: it cannot be driven
  from a keyboard and is awkward on a touch screen. This menu is the equivalent
  route for every action the board offers, and it is always visible rather than
  revealed on hover — the previous implementation hid its actions behind
  `opacity-0 group-hover:opacity-100`, which put them out of reach on a tablet
  entirely.
*/
function PersonMenu({ card, departments, onMove, onRemove }: PersonMenuProps) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const others = departments.filter((dept) => dept.id !== card.deptId);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        aria-label={`Actions for ${card.user.name}`}
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
          setMoveOpen(false);
        }}
        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoveOpen((current) => !current)}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" /> Move to department
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {moveOpen ? (
              <div className="absolute right-full top-0 mr-1 max-h-56 w-48 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
                {others.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-slate-400">No other department yet</p>
                ) : (
                  others.map((dept) => (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setMoveOpen(false);
                        onMove(card, { deptId: dept.id, teamId: null });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
                    >
                      <span className="truncate">{dept.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRemove(card);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-danger-700 transition hover:bg-danger-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove from department
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface PersonChipProps {
  card: PersonCard;
  draggable: boolean;
  departments: DeptInsight[];
  onMove: (card: PersonCard, to: Placement) => void;
  onRemove: (card: PersonCard) => void;
}

function PersonChipBase({ card, draggable, departments, onMove, onRemove }: PersonChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardId(card.user.id, card.deptId),
    data: { card },
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={[
        'flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 transition',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        isDragging ? 'opacity-40' : 'border-slate-100 hover:border-slate-300 hover:shadow-card',
      ].join(' ')}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
        style={roleAvatarStyle(card.user)}
        title={ROLE_TIER_LABEL[roleTier(card.user)]}
      >
        {getInitials(card.user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate text-xs font-semibold text-slate-800">{card.user.name}</span>
          {card.isLead ? (
            <Crown className="h-3 w-3 shrink-0 text-accent-500" aria-label="Department lead" />
          ) : card.isTeamManager ? (
            <Crown className="h-3 w-3 shrink-0 text-blue-600" aria-label="Team manager" />
          ) : null}
        </span>
        <span
          className={`mt-0.5 block truncate text-[9px] font-bold uppercase tracking-[0.08em] ${
            roleTier(card.user) === 'employee' ? 'text-slate-400' : 'text-blue-700'
          }`}
        >
          {card.isLead ? `${roleLabel(card.user)} · dept lead` : roleLabel(card.user)}
        </span>
      </span>
      {draggable ? (
        <PersonMenu card={card} departments={departments} onMove={onMove} onRemove={onRemove} />
      ) : null}
    </div>
  );
}

const PersonChip = memo(PersonChipBase);

/* ────────────────────────────────────────────────────────────────
   Team group — a drop zone inside a column
   ──────────────────────────────────────────────────────────────── */

interface TeamZoneProps {
  deptId: number;
  group: TeamGroup;
  collapsed: boolean;
  onToggle: () => void;
  canManage: boolean;
  currentUserLevel: number;
  departments: DeptInsight[];
  onMove: (card: PersonCard, to: Placement) => void;
  onRemove: (card: PersonCard) => void;
}

function TeamZone({
  deptId,
  group,
  collapsed,
  onToggle,
  canManage,
  currentUserLevel,
  departments,
  onMove,
  onRemove,
}: TeamZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dropZoneId(deptId, group.teamId) });

  return (
    <div
      ref={setNodeRef}
      className={[
        'rounded-lg px-1 pb-1 transition',
        isOver ? 'bg-blue-50 ring-1 ring-blue-300' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-1 pb-1 pt-2 text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
        )}
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {group.name}
        </span>
        {group.teamId !== null && !group.hasManager ? (
          <AlertTriangle className="h-3 w-3 shrink-0 text-accent-500" aria-label="No team manager" />
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-slate-400">
          {group.cards.length}
        </span>
      </button>

      {collapsed ? null : (
        <div className="space-y-1">
          {group.cards.length === 0 ? (
            <p className="px-1 py-2 text-[10px] text-slate-400">Drop someone here</p>
          ) : (
            group.cards.map((card) => (
              <PersonChip
                key={`${card.user.id}:${card.deptId}`}
                card={card}
                draggable={canManage && canManagePerson(card.user, currentUserLevel)}
                departments={departments}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Column
   ──────────────────────────────────────────────────────────────── */

interface ColumnProps {
  column: BoardColumn;
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;
  canManage: boolean;
  canCreateGroups: boolean;
  currentUserLevel: number;
  departments: DeptInsight[];
  onMove: (card: PersonCard, to: Placement) => void;
  onRemove: (card: PersonCard) => void;
  onOpen: (deptId: number) => void;
  onCreateTeam: (deptId: number, name: string) => void;
  onDelete: (deptId: number) => void;
}

function Column({
  column,
  collapsedGroups,
  toggleGroup,
  canManage,
  canCreateGroups,
  currentUserLevel,
  departments,
  onMove,
  onRemove,
  onOpen,
  onCreateTeam,
  onDelete,
}: ColumnProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { dept, groups, total, hasLead } = column;

  const breakdown = useMemo(
    () => describeBreakdown(tierBreakdown(groups.flatMap((group) => group.cards))),
    [groups]
  );

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <div className="flex w-[248px] shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
      <div className={`rounded-t-xl px-3 pb-2.5 pt-3 ${hasLead ? 'bg-blue-50' : 'bg-warning-50'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(dept.id)}
            className="min-w-0 flex-1 truncate text-left text-sm font-bold tracking-[-0.015em] text-slate-950 hover:text-blue-700"
          >
            {dept.name}
          </button>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{total}</span>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label={`Actions for ${dept.name}`}
              onClick={() => setMenuOpen((current) => !current)}
              className="rounded-md p-1 text-slate-400 transition hover:bg-white/70 hover:text-slate-700"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-40 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpen(dept.id); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
                >
                  <UserRound className="h-3.5 w-3.5 text-slate-400" /> Open department
                </button>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setAddingTeam(true); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
                  >
                    <FolderPlus className="h-3.5 w-3.5 text-slate-400" /> New team
                  </button>
                ) : null}
                {canCreateGroups ? (
                  <>
                    <div className="my-1 h-px bg-slate-100" />
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onDelete(dept.id); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-danger-700 transition hover:bg-danger-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete department
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* The role split for this department, so the mix is readable without
            counting avatars. */}
        <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">{breakdown}</p>

        {hasLead ? (
          <p className="mt-1 flex items-center gap-1.5 truncate text-[10px] font-medium text-slate-600">
            <Crown className="h-3 w-3 shrink-0 text-blue-600" />
            <span className="truncate">{dept.leadName}</span>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(dept.id)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-accent-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-warning-800 transition hover:bg-accent-50"
          >
            <AlertTriangle className="h-2.5 w-2.5" /> No lead — assign
          </button>
        )}
      </div>

      <div className="flex max-h-[calc(100vh-22rem)] min-h-[7rem] flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        {groups.map((group) => {
          const key = `${dept.id}:${group.teamId ?? 'none'}`;
          // Hide the empty catch-all when every person already sits in a team.
          if (group.teamId === null && group.cards.length === 0 && groups.length > 1) return null;
          return (
            <TeamZone
              key={key}
              deptId={dept.id}
              group={group}
              collapsed={collapsedGroups.has(key)}
              onToggle={() => toggleGroup(key)}
              canManage={canManage}
              currentUserLevel={currentUserLevel}
              departments={departments}
              onMove={onMove}
              onRemove={onRemove}
            />
          );
        })}
      </div>

      {canManage ? (
        <div className="border-t border-slate-100 p-1.5">
          {addingTeam ? (
            <input
              autoFocus
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              onBlur={() => { setAddingTeam(false); setTeamName(''); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && teamName.trim()) {
                  onCreateTeam(dept.id, teamName.trim());
                  setTeamName('');
                  setAddingTeam(false);
                } else if (event.key === 'Escape') {
                  setAddingTeam(false);
                  setTeamName('');
                }
              }}
              placeholder="Team name, then Enter"
              className="w-full rounded-lg border border-blue-300 px-2 py-1.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTeam(true)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              <Plus className="h-3 w-3" /> New team
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Board
   ──────────────────────────────────────────────────────────────── */

export interface DepartmentBoardProps {
  columns: BoardColumn[];
  departments: DeptInsight[];
  canManage: boolean;
  canCreateGroups: boolean;
  currentUserLevel: number;
  onMove: (card: PersonCard, to: Placement) => void;
  onRemove: (card: PersonCard) => void;
  onOpenDepartment: (deptId: number) => void;
  onCreateDepartment: () => void;
  onCreateTeam: (deptId: number, name: string) => void;
  onDeleteDepartment: (deptId: number) => void;
}

export default function DepartmentBoard({
  columns,
  departments,
  canManage,
  canCreateGroups,
  currentUserLevel,
  onMove,
  onRemove,
  onOpenDepartment,
  onCreateDepartment,
  onCreateTeam,
  onDeleteDepartment,
}: DepartmentBoardProps) {
  const [activeCard, setActiveCard] = useState<PersonCard | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  /*
    An 8px activation distance keeps a plain click on the ⋯ menu from being
    interpreted as the start of a drag. TouchSensor gets a short press delay for
    the same reason, and so that a vertical finger swipe still scrolls the
    column instead of picking a card up.
  */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCard((event.active.data.current as { card?: PersonCard } | undefined)?.card ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const card = (event.active.data.current as { card?: PersonCard } | undefined)?.card ?? null;
    setActiveCard(null);
    if (!card || !event.over) return;

    const target = parseDropZoneId(String(event.over.id));
    if (!target) return;
    if (target.deptId === card.deptId && target.teamId === card.teamId) return;

    onMove(card, target);
  };

  const totalPeople = useMemo(
    () => columns.reduce((sum, column) => sum + column.total, 0),
    [columns]
  );

  if (columns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-sm font-semibold text-slate-900">No departments match your search</p>
        <p className="mt-1 text-sm text-slate-500">Try a different name, or clear the search box.</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveCard(null)}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start gap-3 overflow-x-auto pb-1">
          {columns.map((column) => (
            <Column
              key={column.dept.id}
              column={column}
              collapsedGroups={collapsedGroups}
              toggleGroup={toggleGroup}
              canManage={canManage}
              canCreateGroups={canCreateGroups}
              currentUserLevel={currentUserLevel}
              departments={departments}
              onMove={onMove}
              onRemove={onRemove}
              onOpen={onOpenDepartment}
              onCreateTeam={onCreateTeam}
              onDelete={onDeleteDepartment}
            />
          ))}

          {canCreateGroups ? (
            <button
              type="button"
              onClick={onCreateDepartment}
              className="flex h-24 w-[168px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-slate-300 text-xs font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              New department
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#3D656B' }} />
          Admin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#B3D7DB' }} />
          Manager
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#E4E8EB' }} />
          Employee
        </span>
        <span className="flex items-center gap-1.5">
          <Crown className="h-3 w-3 text-accent-500" /> Department lead
        </span>
        <span className="flex items-center gap-1.5">
          <Crown className="h-3 w-3 text-blue-600" /> Team manager
        </span>

        {canManage ? (
          <span className="flex items-center gap-1.5 border-l border-slate-200 pl-4">
            <ArrowRightLeft className="h-3 w-3" />
            Drag anyone between columns or teams — {totalPeople} shown, every move can be undone.
          </span>
        ) : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-2 py-1.5 shadow-modal">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold"
              style={roleAvatarStyle(activeCard.user)}
            >
              {getInitials(activeCard.user.name)}
            </span>
            <span>
              <span className="block text-xs font-semibold text-slate-800">{activeCard.user.name}</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">
                {roleLabel(activeCard.user)}
              </span>
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
