import React, { createContext, useContext, useState, useEffect } from 'react';
import { format, subDays } from 'date-fns';

interface DateContextType {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  dateStr: string;
}

const DateContext = createContext<DateContextType | undefined>(undefined);

export function DateProvider({ children }: { children: React.ReactNode }) {
  // Default to yesterday
  const [selectedDate, setSelectedDate] = useState<Date>(subDays(new Date(), 1));
  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  return (
    <DateContext.Provider value={{ selectedDate, setSelectedDate, dateStr }}>
      {children}
    </DateContext.Provider>
  );
}

export function useDateContext() {
  const context = useContext(DateContext);
  if (context === undefined) {
    throw new Error('useDateContext must be used within a DateProvider');
  }
  return context;
}
