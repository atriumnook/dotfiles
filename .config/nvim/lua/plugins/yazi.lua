-- ==========================================================
-- yazi.nvim — Terminal file manager integration
-- ==========================================================
-- Requires: brew install yazi
-- https://github.com/mikavilpas/yazi.nvim
return {
  {
    "mikavilpas/yazi.nvim",
    version = "*",
    event = "VeryLazy",
    keys = {
      {
        "<leader>-",
        mode = { "n", "v" },
        "<cmd>Yazi<cr>",
        desc = "Open yazi at the current file",
      },
      {
        "<leader>cw",
        "<cmd>Yazi cwd<cr>",
        desc = "Open the file manager in nvim's working directory",
      },
      {
        "<c-up>",
        "<cmd>Yazi toggle<cr>",
        desc = "Resume the last yazi session",
      },
    },
    ---@type YaziConfig | {}
    opts = {
      open_for_directories = true,
      keymaps = {
        show_help = "<f1>",
      },
    },
    init = function()
      -- disable netrw when using open_for_directories=true
      -- https://github.com/mikavilpas/yazi.nvim/issues/802
      vim.g.loaded_netrwPlugin = 1
    end,
  },
}
