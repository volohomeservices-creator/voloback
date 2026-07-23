import { SupabaseClient } from '@supabase/supabase-js';

// Calculate overall performance score based on weights
export const calculateWorkerPerformanceScore = (metrics: {
    rating: number; // 0-5
    completionRate: number; // 0-100
    acceptanceRate: number; // 0-100
    arrivalAccuracy: number; // 0-100
    responseTimeScore: number; // 0-100
}): number => {
    // Customer Rating = 40% (normalize 0-5 to 0-100)
    const ratingScore = (metrics.rating / 5) * 100 * 0.4;
    
    // Completion Rate = 25%
    const completionScore = metrics.completionRate * 0.25;
    
    // Acceptance Rate = 15%
    const acceptanceScore = metrics.acceptanceRate * 0.15;
    
    // Arrival Accuracy = 10%
    const arrivalScore = metrics.arrivalAccuracy * 0.10;
    
    // Response Time = 10%
    const responseScore = metrics.responseTimeScore * 0.10;
    
    const totalScore = ratingScore + completionScore + acceptanceScore + arrivalScore + responseScore;
    return Math.round(totalScore * 100) / 100; // Round to 2 decimal places
};

// Admin Metrics Reporting
export const generateAdminPerformanceReport = async (supabase: SupabaseClient) => {
    try {
        // Fetch aggregated stats from worker_performance_scores
        const { data: scores, error } = await supabase
            .from('worker_performance_scores')
            .select('*, workers(users(full_name))');
            
        if (error) throw error;
        
        if (!scores || scores.length === 0) {
            return {
                averagePlatformRating: 0,
                topWorkers: [],
                lowestRatedWorkers: [],
                totalJobsCompleted: 0
            };
        }

        const totalRating = scores.reduce((acc, curr) => acc + (curr.rating_score || 0), 0);
        const averagePlatformRating = totalRating / scores.length;
        
        // Sort for top and lowest
        const sortedScores = [...scores].sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
        
        const topWorkers = sortedScores.slice(0, 10).map(s => ({
            id: s.worker_id,
            name: s.workers?.users?.full_name || 'Unknown',
            score: s.overall_score,
            rating: s.rating_score
        }));
        
        const lowestRatedWorkers = [...sortedScores].reverse().slice(0, 10).map(s => ({
            id: s.worker_id,
            name: s.workers?.users?.full_name || 'Unknown',
            score: s.overall_score,
            rating: s.rating_score
        }));

        const totalJobsCompleted = scores.reduce((acc, curr) => acc + (curr.jobs_completed || 0), 0);

        return {
            averagePlatformRating: Math.round(averagePlatformRating * 10) / 10,
            topWorkers,
            lowestRatedWorkers,
            totalJobsCompleted
        };
    } catch (err) {
        console.error('Error generating admin performance report:', err);
        return null;
    }
};

// Worker Metrics Reporting
export const getWorkerPerformanceMetrics = async (supabase: SupabaseClient, workerId: string) => {
    try {
        const { data, error } = await supabase
            .from('worker_performance_scores')
            .select('*')
            .eq('worker_id', workerId)
            .single();
            
        if (error && error.code !== 'PGRST116') throw error;
        
        return data || null;
    } catch (err) {
        console.error('Error fetching worker metrics:', err);
        return null;
    }
};
