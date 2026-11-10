"""Built-in exercise library. Users can add their own on top of these."""
from __future__ import annotations

# (id, name, muscle group, equipment, kind)
_LIBRARY = [
    # Chest
    ("bench_press", "Bench Press", "Chest", "Barbell", "weight_reps"),
    ("incline_bench_press", "Incline Bench Press", "Chest", "Barbell", "weight_reps"),
    ("db_bench_press", "Dumbbell Bench Press", "Chest", "Dumbbell", "weight_reps"),
    ("incline_db_press", "Incline Dumbbell Press", "Chest", "Dumbbell", "weight_reps"),
    ("chest_fly_machine", "Chest Fly (Machine)", "Chest", "Machine", "weight_reps"),
    ("cable_crossover", "Cable Crossover", "Chest", "Cable", "weight_reps"),
    ("push_up", "Push-up", "Chest", "Bodyweight", "bodyweight_reps"),
    ("dip", "Dip", "Chest", "Bodyweight", "bodyweight_reps"),
    # Back
    ("deadlift", "Deadlift", "Back", "Barbell", "weight_reps"),
    ("barbell_row", "Barbell Row", "Back", "Barbell", "weight_reps"),
    ("db_row", "Dumbbell Row", "Back", "Dumbbell", "weight_reps"),
    ("lat_pulldown", "Lat Pulldown", "Back", "Cable", "weight_reps"),
    ("seated_cable_row", "Seated Cable Row", "Back", "Cable", "weight_reps"),
    ("pull_up", "Pull-up", "Back", "Bodyweight", "bodyweight_reps"),
    ("chin_up", "Chin-up", "Back", "Bodyweight", "bodyweight_reps"),
    ("t_bar_row", "T-Bar Row", "Back", "Machine", "weight_reps"),
    # Legs
    ("squat", "Squat", "Legs", "Barbell", "weight_reps"),
    ("front_squat", "Front Squat", "Legs", "Barbell", "weight_reps"),
    ("romanian_deadlift", "Romanian Deadlift", "Legs", "Barbell", "weight_reps"),
    ("leg_press", "Leg Press", "Legs", "Machine", "weight_reps"),
    ("leg_extension", "Leg Extension", "Legs", "Machine", "weight_reps"),
    ("leg_curl", "Leg Curl", "Legs", "Machine", "weight_reps"),
    ("bulgarian_split_squat", "Bulgarian Split Squat", "Legs", "Dumbbell", "weight_reps"),
    ("walking_lunge", "Walking Lunge", "Legs", "Dumbbell", "weight_reps"),
    ("hip_thrust", "Hip Thrust", "Legs", "Barbell", "weight_reps"),
    ("calf_raise", "Calf Raise", "Legs", "Machine", "weight_reps"),
    ("goblet_squat", "Goblet Squat", "Legs", "Dumbbell", "weight_reps"),
    # Shoulders
    ("overhead_press", "Overhead Press", "Shoulders", "Barbell", "weight_reps"),
    ("db_shoulder_press", "Dumbbell Shoulder Press", "Shoulders", "Dumbbell", "weight_reps"),
    ("lateral_raise", "Lateral Raise", "Shoulders", "Dumbbell", "weight_reps"),
    ("rear_delt_fly", "Rear Delt Fly", "Shoulders", "Dumbbell", "weight_reps"),
    ("face_pull", "Face Pull", "Shoulders", "Cable", "weight_reps"),
    # Arms
    ("barbell_curl", "Barbell Curl", "Arms", "Barbell", "weight_reps"),
    ("db_curl", "Dumbbell Curl", "Arms", "Dumbbell", "weight_reps"),
    ("hammer_curl", "Hammer Curl", "Arms", "Dumbbell", "weight_reps"),
    ("tricep_pushdown", "Tricep Pushdown", "Arms", "Cable", "weight_reps"),
    ("skull_crusher", "Skull Crusher", "Arms", "Barbell", "weight_reps"),
    ("overhead_tricep_ext", "Overhead Tricep Extension", "Arms", "Dumbbell", "weight_reps"),
    # Core
    ("plank", "Plank", "Core", "Bodyweight", "duration"),
    ("hanging_leg_raise", "Hanging Leg Raise", "Core", "Bodyweight", "bodyweight_reps"),
    ("cable_crunch", "Cable Crunch", "Core", "Cable", "weight_reps"),
    ("ab_wheel", "Ab Wheel Rollout", "Core", "Bodyweight", "bodyweight_reps"),
    # Cardio
    ("treadmill", "Treadmill", "Cardio", "Machine", "distance"),
    ("rowing_machine", "Rowing Machine", "Cardio", "Machine", "distance"),
    ("stationary_bike", "Stationary Bike", "Cardio", "Machine", "duration"),
    ("stair_climber", "Stair Climber", "Cardio", "Machine", "duration"),
]

BUILTIN_EXERCISES = [
    {"id": i, "name": n, "muscle": m, "equipment": e, "kind": k, "custom": False}
    for i, n, m, e, k in _LIBRARY
]
