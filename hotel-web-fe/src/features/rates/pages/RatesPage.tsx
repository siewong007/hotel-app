import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EditCalendarIcon from '@mui/icons-material/EditCalendar';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { BulkRateDialog } from '../components/BulkRateDialog';
import { RateCalendarGrid } from '../components/RateCalendarGrid';
import { RateCellPopover } from '../components/RateCellPopover';
import { RatePlanDialog } from '../components/RatePlanDialog';
import { RatePlanTable } from '../components/RatePlanTable';
import { RoomRatesEditor } from '../components/RoomRatesEditor';
import { useRateCalendar } from '../hooks/useRateCalendar';
import {
  useRatePlanMutations,
  useRatePlanWithRates,
  useRatePlans,
  useRateRoomTypes,
  useRoomRateMutations,
} from '../hooks/useRatePlans';
import type { RateCalendarCell, RatePlan } from '../types';

type RatesTab = 'calendar' | 'plans';

const RatesPage = () => {
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const { currency } = useCurrency();
  const canReadPlans = hasPermission('rooms:read') || hasPermission('rooms:manage');
  const canManagePlans =
    hasPermission('rooms:write') || hasPermission('rooms:manage');

  const [tab, setTab] = useState<RatesTab>('calendar');
  const [inspected, setInspected] = useState<{
    cell: RateCalendarCell;
    anchor: HTMLElement;
  } | null>(null);
  const [planDialog, setPlanDialog] = useState<{
    open: boolean;
    plan: RatePlan | null;
  }>({ open: false, plan: null });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);

  const calendar = useRateCalendar();
  const plans = useRatePlans();
  const roomTypes = useRateRoomTypes();
  const planMutations = useRatePlanMutations();
  const planWithRates = useRatePlanWithRates(editingPlanId);
  const rateMutations = useRoomRateMutations(editingPlanId);

  const today = useMemo(() => formatLocalDate(new Date()), []);
  const dates = useMemo(() => {
    if (!calendar.calendar) return [];
    const days: string[] = [];
    let cursor = new Date(`${calendar.calendar.from}T12:00:00`);
    const end = calendar.calendar.to;
    while (formatLocalDate(cursor) <= end) {
      days.push(formatLocalDate(cursor));
      cursor = addLocalDays(cursor, 1);
    }
    return days;
  }, [calendar.calendar]);

  return (
    <Box>
      <PageHeader
        title="Rates"
        subtitle="Resolved rate calendar and rate-plan management"
        actions={
          canManagePlans ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<EditCalendarIcon />}
                onClick={() => setBulkOpen(true)}
              >
                Bulk rates
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setPlanDialog({ open: true, plan: null })}
              >
                New plan
              </Button>
            </Box>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={(_, value: RatesTab) => setTab(value)}
        sx={{ mb: 2 }}
      >
        <Tab value="calendar" label="Rate Calendar" />
        {canReadPlans && <Tab value="plans" label="Rate Plans" />}
      </Tabs>

      {tab === 'calendar' && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Button
              size="small"
              startIcon={<ChevronLeftIcon />}
              onClick={() => calendar.shiftWindow(-14)}
            >
              Previous
            </Button>
            <Typography variant="body2" color="text.secondary">
              {calendar.window.from} → {calendar.window.to}
            </Typography>
            <Button
              size="small"
              endIcon={<ChevronRightIcon />}
              onClick={() => calendar.shiftWindow(14)}
            >
              Next
            </Button>
          </Box>
          {calendar.isLoading && <Skeleton variant="rounded" height={360} />}
          {calendar.error && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => calendar.refetch()}
                >
                  Retry
                </Button>
              }
            >
              The rate calendar could not be loaded.
            </Alert>
          )}
          {calendar.calendar && calendar.calendar.room_types.length === 0 && (
            <EmptyState
              title="No active room types"
              description="Activate a room type before managing rates."
            />
          )}
          {calendar.calendar && calendar.calendar.room_types.length > 0 && (
            <RateCalendarGrid
              roomTypes={calendar.calendar.room_types}
              dates={dates}
              cells={calendar.cells}
              currency={currency}
              today={today}
              onInspectCell={(cell, anchor) => setInspected({ cell, anchor })}
            />
          )}
        </>
      )}

      {tab === 'plans' && canReadPlans && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          {plans.isLoading && <Skeleton variant="rounded" height={240} />}
          {plans.error && (
            <Alert severity="error">Rate plans could not be loaded.</Alert>
          )}
          {plans.data && plans.data.length === 0 && (
            <EmptyState
              title="No rate plans"
              description="Create a rate plan to start pricing rooms by date."
            />
          )}
          {plans.data && plans.data.length > 0 && (
            <RatePlanTable
              plans={plans.data}
              canManage={canManagePlans}
              onEdit={(plan) => {
                setEditingPlanId(plan.id);
                setPlanDialog({ open: true, plan });
              }}
              onToggleActive={(plan, active) =>
                planMutations.updatePlan.mutate({
                  id: plan.id,
                  input: { is_active: active },
                })
              }
              onDelete={async (plan) => {
                if (
                  !(await confirm({
                    title: 'Delete rate plan',
                    message: `Delete “${plan.name}”? Its rate bands are removed with it.`,
                    confirmText: 'Delete',
                    severity: 'warning',
                  }))
                ) {
                  return;
                }
                planMutations.deletePlan.mutate(plan.id);
              }}
            />
          )}
        </Paper>
      )}

      <RateCellPopover
        cell={inspected?.cell ?? null}
        anchor={inspected?.anchor ?? null}
        roomTypeName={
          calendar.calendar?.room_types.find(
            (room) => room.room_type_id === inspected?.cell.room_type_id,
          )?.name ?? ''
        }
        currency={currency}
        onClose={() => setInspected(null)}
      />

      <RatePlanDialog
        open={planDialog.open}
        plan={planDialog.plan}
        saving={planMutations.createPlan.isPending || planMutations.updatePlan.isPending}
        onClose={() => setPlanDialog({ open: false, plan: null })}
        onSubmit={(input) => {
          const done = () => setPlanDialog({ open: false, plan: null });
          if (planDialog.plan) {
            planMutations.updatePlan.mutate(
              { id: planDialog.plan.id, input },
              { onSuccess: done },
            );
          } else {
            planMutations.createPlan.mutate(input, { onSuccess: done });
          }
        }}
      >
        {planDialog.plan && planWithRates.data && (
          <RoomRatesEditor
            rates={planWithRates.data.rates}
            roomTypes={roomTypes.data ?? []}
            onAdd={(input) =>
              rateMutations.createRate.mutate({
                rate_plan_id: planDialog.plan!.id,
                ...input,
              })
            }
            onUpdate={(id, input) =>
              rateMutations.updateRate.mutate({ id, input })
            }
            onDelete={(id) => rateMutations.deleteRate.mutate(id)}
          />
        )}
      </RatePlanDialog>

      <BulkRateDialog
        open={bulkOpen}
        plans={plans.data ?? []}
        roomTypes={roomTypes.data ?? []}
        saving={rateMutations.bulkUpsert.isPending}
        onClose={() => setBulkOpen(false)}
        onSubmit={(input) =>
          rateMutations.bulkUpsert.mutate(input, {
            onSuccess: () => setBulkOpen(false),
          })
        }
      />
    </Box>
  );
};

export default RatesPage;
