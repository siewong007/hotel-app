import { useCallback, useEffect, useMemo, useState } from 'react';

import { getOnlineInventory, updateOnlineInventory } from '../api';
import type { OnlineInventoryAllocation } from '../types';

const isSameConfiguration = (
  current: OnlineInventoryAllocation,
  saved: OnlineInventoryAllocation | undefined,
) =>
  saved !== undefined &&
  current.walk_in_reserved_rooms === saved.walk_in_reserved_rooms &&
  current.online_booking_enabled === saved.online_booking_enabled &&
  comparablePrice(current.custom_price) === comparablePrice(saved.custom_price);

const comparablePrice = (value: string | null) => {
  if (value === null) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : value;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export const useOnlineInventory = (stayDate: string) => {
  const [items, setItems] = useState<OnlineInventoryAllocation[]>([]);
  const [savedItems, setSavedItems] = useState<OnlineInventoryAllocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setItems([]);
    setSavedItems([]);
    try {
      const allocations = await getOnlineInventory(stayDate);
      setItems(allocations);
      setSavedItems(allocations);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Unable to load online inventory.'));
    } finally {
      setIsLoading(false);
    }
  }, [stayDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedByRoomType = useMemo(
    () => new Map(savedItems.map((item) => [item.room_type_id, item])),
    [savedItems],
  );

  const changedItems = useMemo(
    () => items.filter((item) => !isSameConfiguration(item, savedByRoomType.get(item.room_type_id))),
    [items, savedByRoomType],
  );

  const updateItem = useCallback(
    (roomTypeId: number, patch: Partial<Pick<OnlineInventoryAllocation, 'walk_in_reserved_rooms' | 'online_booking_enabled' | 'custom_price'>>) => {
      setSuccessMessage(null);
      setItems((current) =>
        current.map((item) => (item.room_type_id === roomTypeId ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const discardChanges = useCallback(() => {
    setItems(savedItems);
    setSuccessMessage(null);
    setError(null);
  }, [savedItems]);

  const saveChanges = useCallback(async () => {
    if (changedItems.length === 0) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    const results = await Promise.allSettled(
      changedItems.map((item) =>
        updateOnlineInventory(item.room_type_id, stayDate, {
          walk_in_reserved_rooms: item.walk_in_reserved_rooms,
          online_booking_enabled: item.online_booking_enabled,
          custom_price: item.custom_price,
        }),
      ),
    );

    const updated = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const updatedByRoomType = new Map(updated.map((item) => [item.room_type_id, item]));

    if (updated.length > 0) {
      setItems((current) =>
        current.map((item) => updatedByRoomType.get(item.room_type_id) ?? item),
      );
      setSavedItems((current) =>
        current.map((item) => updatedByRoomType.get(item.room_type_id) ?? item),
      );
    }

    const failedCount = results.length - updated.length;
    if (failedCount > 0) {
      const firstFailure = results.find((result) => result.status === 'rejected');
      const detail = firstFailure?.status === 'rejected'
        ? errorMessage(firstFailure.reason, 'Please try again.')
        : 'Please try again.';
      setError(`${failedCount} room ${failedCount === 1 ? 'type' : 'types'} could not be saved. ${detail}`);
    } else {
      setSuccessMessage(`${updated.length} room ${updated.length === 1 ? 'type' : 'types'} updated.`);
    }

    setIsSaving(false);
  }, [changedItems, stayDate]);

  return {
    items,
    changedRoomTypeIds: new Set(changedItems.map((item) => item.room_type_id)),
    changedCount: changedItems.length,
    isLoading,
    isSaving,
    error,
    successMessage,
    clearSuccessMessage: () => setSuccessMessage(null),
    updateItem,
    discardChanges,
    saveChanges,
    reload: load,
  };
};
