# Quest Planner Addon Registry

Official addon registry for [Quest Planner](https://github.com/nenadjokic/dndplanning) - the self-hosted D&D session planner.

## Available Addons

| Addon | Description | Version |
|-------|-------------|---------|
| [Addon Developer Kit](packages/) | Documentation, scaffolder, validator, and preview tools for building addons | 1.0.0 |

## Installing Addons

1. Go to **Admin > Addons > Browse Store** in your Quest Planner instance
2. Find the addon you want and click **Download**
3. Go to **Upload** tab and upload the `.qpa` file
4. The addon is automatically installed and enabled

## Creating Your Own Addon

Install the **Addon Developer Kit** addon for a complete guide, scaffolder, and validator built right into Quest Planner.

Or read the documentation:
- [Creating Addons](https://github.com/nenadjokic/dndplanning/blob/main/docs/addons/CREATING-ADDONS.md)
- [Addon API Reference](https://github.com/nenadjokic/dndplanning/blob/main/docs/addons/ADDON-API.md)
- [Submission Guide](https://github.com/nenadjokic/dndplanning/blob/main/docs/addons/SUBMISSION-GUIDE.md)

## Submitting an Addon

1. Fork this repository
2. Add your `.qpa` file to `packages/`
3. Add your addon entry to `registry.json`
4. Submit a Pull Request

## Custom Repositories

Quest Planner supports custom addon repositories. Add your GitHub repo URL in **Admin > Addons > Browse Store > Manage Repositories**. Your repo needs a `registry.json` file in its root with the same format as this one.
