export const QUOTES = [
  // Identity & Mindset
  "Every action you take is a vote for the type of person you wish to become.",
  "First we make our habits, then our habits make us.",
  "Motivation gets you started; habit keeps you going.",
  "You do not rise to the level of your goals; you fall to the level of your systems.",
  "Simplify the system without making it simplistic.",
  "The difference between who you are and who you want to be is what you do.",
  "Good habits make time your ally; bad habits make time your enemy.",
  "The heaviest lifting is done in the mind first, and the body second.",
  "Awareness is the space where your habits are consciously chosen, not just blindly repeated.",
  "The cost of your good habits is in the present; the cost of your bad habits is in the future.",
  
  // Consistency & Compounding
  "Small disciplines repeated with consistency lead to massive achievements.",
  "Your habits are the compound interest of self-improvement.",
  "If you get 1% better each day, you’ll end up 37 times better by the end of the year.",
  "Consistency always beats intensity.",
  "What you do every day matters infinitely more than what you do once in a while.",
  "Success is the product of daily habits, not once-in-a-lifetime transformations.",
  "Repetition is the architect of accomplishment.",
  "Momentum is built one small rep at a time.",
  "A journey of a thousand miles begins with a single, habitual step.",
  "Trust the process. The results will eventually catch up.",
  
  // Overcoming Friction
  "Amateurs sit and wait for inspiration; professionals just get up and go to work.",
  "Make it obvious, make it attractive, make it easy, make it satisfying.",
  "Don't wait for the perfect moment; take the moment and make it a habit.",
  "Make the right choice the easy choice.",
  "Carry the weight of discipline today, or carry the weight of regret tomorrow.",
  "Be the architect of your environment, not the victim of it.",
  "Motion is not action. Stop planning and start doing.",
  "The obstacle is the path. Step into it daily.",
  "Simplify the process and the friction will disappear.",
  "Master the art of simply showing up.",
  
  // Resilience & Endurance
  "Missing one day is an accident. Missing two is the start of a new habit.",
  "Endure the discomfort of discipline or suffer the pain of regret.",
  "Chop wood, carry water. The magic is in the mundane.",
  "The harder the habit, the greater the strength it builds.",
  "Progress is not linear. Keep pushing through the plateau.",
  "True freedom is found in strict routine.",
  "Don't break the chain.",
  "Do the thing, and you shall have the power.",
  "You don't have to be extreme, you just have to be consistent.",
  "In the opening, mid-game, and endgame of your day, rely on your systems.",
  
  // Execution & Focus
  "Forget the ultimate goal; what is the very next physical action?",
  "Standardize before you optimize.",
  "Less but better. Keep the system clean.",
  "Win the morning, win the day.",
  "You can't improve what you don't measure.",
  "It’s not about having time; it’s about making time.",
  "Focus on the system, not the outcome.",
  "Breathe. Focus. Execute. Repeat.",
  "Excellence is an art won by training and habituation.",
  "Today's simple routine is tomorrow's solid foundation."
];

/**
 * Returns the same quote consistently for a given calendar day.
 */
export function getDailyQuote(): string {
  const today = new Date();
  // Create a predictable number based on the current date (YYYY-MM-DD)
  const dateString = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  
  let hash = 0;
  for (let i = 0; i < dateString.length; i++) {
    hash = ((hash << 5) - hash + dateString.charCodeAt(i)) | 0;
  }
  
  // Use modulo to wrap around the array length safely
  const index = Math.abs(hash) % QUOTES.length;
  return QUOTES[index];
}
