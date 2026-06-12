export interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  subs?: { id: string; label: string; }[];
}

export type DateRangeType = 
  | 'today' | 'yesterday' | 'past_7' | 'past_14' | 'past_30' 
  | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
