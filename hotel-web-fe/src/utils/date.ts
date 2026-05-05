export const formatLocalDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const parseLocalDate = (dateString: string): Date => {
  const [datePart] = dateString.split('T');
  const [year, month, day] = datePart.split('-').map(Number);

  return new Date(year, month - 1, day);
};

export const addLocalDays = (date: Date | string, days: number): Date => {
  const base = typeof date === 'string' ? parseLocalDate(date) : date;
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  next.setDate(next.getDate() + days);

  return next;
};
