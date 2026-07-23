export type ManualAssignmentStatus = 'ASSIGNED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REASSIGNED';

export interface ManualAssignmentHistory {
  id: string;
  booking_id: string;
  worker_id: string;
  assigned_by: string;
  status: ManualAssignmentStatus;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RankingCandidate {
  workerId: string;
  score: number;
  distance: number;
  rating: number;
  jobs: number;
  acceptanceRate: number;
  name?: string;
  phone?: string;
  availability?: {
    working_days: string[];
    start_time: string;
    end_time: string;
    vacation_mode: boolean;
    unavailable_dates: string[];
  } | null;
}
