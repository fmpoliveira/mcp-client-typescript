# MCP Client TypeScript

## Setup Instructions

1. **Add API Keys**

   - Create a `.env` file in the project root if it does not exist.
   - Add the following environment variables:
     ```
     ANTHROPIC_API_KEY=your_anthropic_api_key_here
     METEOSTAT_RAPID_API_KEY=your_meteostat_rapid_api_key_here
     ```

2. **Build the Project**

   - Run the following command to build the project:
     ```bash
     npm run build
     ```

3. **Configure MCP Servers**

   - The `package.json` file contains the list of MCP server paths under `build/index.js`.
   - You can modify this list to include multiple MCP servers as needed.

4. **Start the MCP Client**
   - Ensure that all MCP servers are running before starting the client.
   - Run the following command to start the client:
     ```bash
     npm run start
     ```
