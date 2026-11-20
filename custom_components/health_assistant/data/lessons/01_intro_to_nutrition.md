# Intro to Nutrition

Every day, your body expends a specific amount of energy, measured in **calories**. To fuel this constant energy requirement, you consume energy through food.

- If you consume **more energy than your body burns**, the excess energy is stored for later—primarily as body fat.
- If you consume **less energy than your body burns**, your body draws on stored energy reserves (fat, glycogen, and muscle tissue) to bridge the gap.

At its core, body weight management comes down to energy balance: if **calories in are less than calories out, you will lose weight.**

---

## The Importance of Nutrition

It is easy to overestimate how many calories workouts burn and underestimate how much energy resting requires.

Every day, your body burns a baseline number of calories just to keep you alive—powering your brain, heart, lungs, cellular repair, and basic organ function. This base energy requirement is called your **Basal Metabolic Rate (BMR)**. For most individuals, BMR accounts for **60% to 70%** of total daily calorie expenditure.

The remaining ~30% of your daily burn comes from the energy needed to digest food (the Thermic Effect of Food) and physical movement—ranging from walking and fidgeting to structured exercise.

```
Total Daily Energy Expenditure (TDEE)
├── Basal Metabolic Rate (BMR): ~60–70% (Resting cellular & organ functions)
├── Thermic Effect of Food (TEF): ~10% (Digesting & processing food)
└── Physical Activity & NEAT: ~15–30% (Exercise, walking, daily movement)
```

Consider it from an efficiency standpoint: running for 30 minutes might burn roughly 300 calories, which can be wiped out in seconds by a single high-calorie snack. Managing your nutritional intake is the most direct and effective leverage point you have for controlling your energy balance.

Furthermore, nutrition extends far beyond scale weight. What you eat directly affects your daily energy stability, cognitive focus, recovery rate, and hunger signals.

---

## What Is a Calorie?

All food provides energy that can be measured in **kilocalories** (commonly referred to simply as *calories*).

> **Scientific Definition:** A kilocalorie (kcal) is the amount of heat energy required to raise the temperature of 1 kilogram of water by 1 degree Celsius.

Food packaging lists energy content per serving, allowing you to track total input. However, volume does not equal caloric density. For example, a large bowl of lettuce contains roughly 70 calories, while a single tablespoon of cooking oil contains nearly 120 calories.

### Macronutrients

Calories describe the *quantity* of energy, but energy comes in different forms called **macronutrients**: proteins, carbohydrates, and fats.

So how much should you have of each per day? 

### Calories: 

Outdated guidelines say that most adult men need 2,500 calories per day, and adult women need 2,000 calories per day. However, these figures change significantly based on your job, your age, your activity levels outside of work, and your hobbies! Similarly to your weight, **a number does not dictate how healthy you are!** You could eat an incredibly nutrient-poor 2,300 calories, or a very nutrient-dense 5,000 calories, and depending on your body and needs, the health outcomes would be wildly different. 

When you set up this integration in Home Assistant, you entered your body details and goals; this should provide you with an estimate for your maintenance needs, as well as weight loss needs. It is generally not recommended to be in a deficit of more than 500 to 700 calories per day, especially for those trying to lose weight and retain or build muscle at the same time. 

Based on the values you provided during setup, we calculated your maintenance calories to be roughly {mxcal} per day. So, if you wanted to lose one pound of fat per week, you'd aim for about {deficit} per day. Inversely, if you wanted to add weight, you'd add about 500 calories per day to your maintenance. 

### Protein: 

While many gym bros and bodybuilders in the past have sworn by upwards of 200 grams of protein per day, modern research suggests that optimal protein intake for active individuals ranges between 0.7 to 1.0 grams of protein per pound of bodyweight per day (or about 1.6 to 2.2 grams per kilogram). For general health and basic needs, a baseline of around 0.6 grams per pound is a solid starting point—meaning an 180-pound individual would aim for roughly 108 grams per day. However, if you are actively lifting weights or in a calorie deficit, aiming for 0.8 to 1.0 grams per pound helps preserve lean muscle mass.

One of the reasons protein is so beneficial is the Thermic Effect of Food, which we discussed briefly earlier—how many calories your body burns just digesting and processing food. For fats and carbohydrates, the body is relatively efficient (expending roughly 0–3% and 5–10% of energy on digestion, respectively). However, protein takes significantly more work to break down, expending about 20–30% of its energy content during digestion. As a result, your body nets fewer usable calories per gram of protein.

Proteins can be either complete or incomplete. Complete proteins contain all 9 essential amino acids our bodies cannot produce on their own, whereas incomplete proteins lack one or more of these essential amino acids and are best combined with complementary sources throughout the day. 

**Complete Protein Sources**: Eggs, dairy products, fish, meat, soy (tofu, edamame), hemp seeds, quinoa

**Incomplete Protein Pairings**: Lentils & Rice, Brown Rice & Black Beans, Noodles & Peanut Sauce, Hummus & Pita

Based on the values you provided during setup and your activity levels, we'd recommend aiming for {protein} per day.

### Fats:

Despite dietary fats having been villainized in the past, they are crucial for hormone production, brain health, and nutrient absorption. A common general target is to get roughly 20% to 35% (about 1/3) of your daily calories from fat. Dietary fats are divided into two primary categories, with unsaturated fat split into two sub-types:

**Monounsaturated Fats:** These unsaturated fats are linked to several cardiovascular benefits and are typically liquid at room temperature. Good sources include extra virgin olive oil, avocados, almonds, and various nuts and seeds. 

**Polyunsaturated Fats:** These unsaturated fats are essential for cellular health, immune function, and brain function (including omega-3 and omega-6 fatty acids). Examples include fatty fish (salmon, mackerel), flaxseeds, chia seeds, walnuts, and vegetable oils. 

**Saturated Fats:** These are primarily found in animal products and tropical oils. While they play key roles in bodily functions, excessive intake can raise LDL cholesterol levels and is linked to cardiovascular disease risk. Guidelines generally suggest keeping saturated fat intake to under 10% (or under 7–10% for heart health) of your total daily calories. Examples include butter, fatty cuts of meat, full-fat dairy, palm oil, and baked goods. 

**Trans Fats:** Artificial trans fats (partially hydrogenated oils) significantly increase heart disease risk and should be avoided entirely. 

Based on the values you provided during setup, we'd recommend you aim for about {fats} of fats per day.

### Carbs:

Carbohydrates are your body's primary and preferred energy source, breaking down into glucose to fuel your brain, organs, and intense physical exercise. Excess glucose is stored in limited amounts in your muscles and liver as **glycogen** for quick access later (and converted to fat reserves only when glycogen stores are full and total energy intake exceeds daily needs).

Rather than labeling carbs as strict "good" or "bad," it helps to understand how different types affect your body. Complex carbs release energy steadily because of their fiber and structure, providing sustained fuel and nutrients. Refined and simple carbs break down quickly, making them useful for rapid energy replenishment before or after workouts. 

**Simple / Refined Carbs**: White bread, white rice, table sugar, pastries, fruit (contains simple sugars alongside natural fiber and vitamins), honey

**Complex Carbs**: Oats, potatoes, sweet potatoes, whole grains, beans, lentils, corn, vegetables

**Dietary Fiber** is a specialized form of carbohydrate. Unlike simple or complex starches, human digestive enzymes cannot fully break down fiber into glucose. As a result, fiber yields minimal net calories while playing a vital role in digestive health, blood sugar regulation, and satiety. Because of its importance, Health Assistant will track fiber in addition to your macros and calories. High-fiber foods include fruits, vegetables, whole grains, nuts, seeds, and legumes.

Because carbohydrates are the main fuel for your body, here are the recommended amounts by how much exercise you do, per pound of body weight. 

| Exercise | Description | Carbs per lb of bodyweight |
| Light | Low intensity | 1.5g - 2.5g |
| Moderate | Around 1 hour | 2.5g - 3.5g |
| High | 1-3 hours, moderate-high intensity | 3g - 5g |
| Very High | 4-5 hours, moderate-high intensity | 4g - 6g |

Based on the values you provided, your recommended daily carbohydrate intake is {carbs}.

---

## Should We Track Our Calories?

Tracking calories and limiting what you eat is often associated with rigid behaviors; however, when done properly with a healthy mindset, tracking what you eat is a powerful educational tool. Imagine how stressful it would be to drive a car with no fuel gauge! In a way, tracking our food allows us to understand both the quantity and quality of the fuel we are putting into our bodies. 

My recommended approach is this: for 1–2 weeks, don't try to make any drastic changes. Just track everything you normally eat. Getting a small digital food scale can make this immensely easier, as measuring food by weight (grams or ounces) is much more accurate than volume estimates. Research consistently shows that humans are prone to underestimating their calorie intake by 20% to 50%. 

Once you have a baseline for how much you are eating regularly—and have started to get a sense for what fills you up, what makes you feel energized, and what contains high calorie density—you can start making informed modifications to your diet. 

The most important thing to remember is this: we should never be aiming for a specific number on a scale, a certain number of calories, or restricting ourselves from our favorite food. Rather, our goal should be full body holistic **health**. 

---

## Additional Learning: 
- *The Science of Nutrition* – Rhiannon Lambert (pub. 2021)

> This article was written by app author Toribus, based on information found in the book *The Science of Nutrition* by Rhiannon Lambert (published 2021). For suggested changes to accuracy or content, please open a pull request in the GitHub project. Please consult a qualified medical professional or registered dietitian before making significant changes to your diet.
