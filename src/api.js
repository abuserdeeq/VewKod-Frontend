// Replace with your deployed Render backend URL
const API_BASE_URL = "https://your-vewkod-backend.onrender.com";

export async function explainCode(code, difficulty) {
  const response = await fetch(`${API_BASE_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, difficulty }),
  });

  if (!response.ok) {
    throw new Error("Failed to get explanation from server.");
  }

  const data = await response.json();
  return data.explanation;
}