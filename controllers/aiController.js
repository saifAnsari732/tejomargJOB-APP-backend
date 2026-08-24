const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// @desc    Generate Job Description using Gemini
// @route   POST /api/ai/generate-job-description
// @access  Private (Employer)
const generateJobDescription = async (req, res) => {
  try {
    const { title, category } = req.body;
    
    if (!title) {
      return res.status(400).json({ message: 'Job title is required' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ message: 'Gemini is not configured on the server' });
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      You are an expert technical recruiter and copywriter.
      Write a highly professional, engaging, and well-structured job description for a "${title}" in the "${category || 'General'}" category.
      Also, provide a list of 5 to 10 relevant skills for this job.
      
      You MUST respond in pure JSON format ONLY. Do not use markdown blocks. The JSON should have two keys:
      "description" (string, keep it under 300 words, no placeholder brackets)
      "skills" (array of strings)
    `;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch(e) {
      data = { description: responseText, skills: [] };
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Gemini Error (Job Description):', error);
    res.status(500).json({ message: error?.message || 'Failed to generate job description' });
  }
};

// @desc    Generate Candidate Bio using Gemini
// @route   POST /api/ai/generate-bio
// @access  Private (Candidate)
const generateBio = async (req, res) => {
  try {
    const { skills, experience, title } = req.body;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
      You are an expert career coach helping a candidate write their professional bio/headline.
      The candidate has the following profile:
      - Title/Role: ${title || 'Professional'}
      - Skills: ${skills || 'Various skills'}
      - Experience: ${experience || 'Some experience'}

      Write a compelling, professional, and concise 2-3 sentence bio that the candidate can use on their job profile. 
      Write in the first person ("I am a..."). Do not include quotes.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    res.status(200).json({ bio: responseText.trim() });
  } catch (error) {
    console.error('Gemini Error (Bio):', error);
    res.status(500).json({ message: 'Failed to generate bio' });
  }
};

module.exports = {
  generateJobDescription,
  generateBio
};
