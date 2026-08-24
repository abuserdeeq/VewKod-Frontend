export const EXAMPLE_SNIPPETS = [
  {
    id: "python-loop",
    name: "Python Loop",
    language: "python",
    code: `def calculate_sum(numbers):
    # Initialize total to zero
    total = 0

    # Loop through each number
    for num in numbers:
        total += num

    return total

# Test the function
result = calculate_sum([1, 2, 3, 4, 5])
print(f"Sum: {result}")`,
  },
  {
    id: "js-fetch",
    name: "JavaScript Fetch",
    language: "javascript",
    code: `async function getUserData(userId) {
    try {
        const response = await fetch(\`/api/users/\${userId}\`);

        if (!response.ok) {
            throw new Error('Failed to fetch user');
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}`,
  },
  {
    id: "java-class",
    name: "Java Class",
    language: "java",
    code: `public class BankAccount {
    private double balance;
    private String owner;

    public BankAccount(String owner, double initialBalance) {
        this.owner = owner;
        this.balance = initialBalance;
    }

    public void deposit(double amount) {
        if (amount > 0) {
            balance += amount;
        }
    }

    public double getBalance() {
        return balance;
    }
}`,
  },
  {
    id: "cpp-vector",
    name: "C++ Vector",
    language: "cpp",
    code: `#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> numbers = {5, 2, 8, 1, 9};

    // Sort the vector
    std::sort(numbers.begin(), numbers.end());

    // Print sorted numbers
    for (int num : numbers) {
        std::cout << num << " ";
    }

    return 0;
}`,
  },
];

export const LANGUAGES = [
  { id: "python", name: "Python", icon: "🐍" },
  { id: "javascript", name: "JavaScript", icon: "⚡" },
  { id: "typescript", name: "TypeScript", icon: "📘" },
  { id: "java", name: "Java", icon: "☕" },
  { id: "cpp", name: "C++", icon: "⚙️" },
  { id: "c", name: "C", icon: "🔧" },
  { id: "csharp", name: "C#", icon: "🔷" },
  { id: "go", name: "Go", icon: "🐹" },
  { id: "rust", name: "Rust", icon: "🦀" },
  { id: "php", name: "PHP", icon: "🐘" },
  { id: "ruby", name: "Ruby", icon: "💎" },
  { id: "swift", name: "Swift", icon: "🍎" },
  { id: "kotlin", name: "Kotlin", icon: "📱" },
  { id: "sql", name: "SQL", icon: "🗄️" },
  { id: "bash", name: "Bash", icon: "🐚" },
  { id: "html", name: "HTML", icon: "🌐" },
  { id: "css", name: "CSS", icon: "🎨" },
  { id: "auto", name: "Auto Detect", icon: "🔍" },
];
