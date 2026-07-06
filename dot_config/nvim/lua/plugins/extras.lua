vim.g.lazyvim_ts_lsp = "tsgo"

return {
  { import = "lazyvim.plugins.extras.editor.neo-tree" },
  { import = "lazyvim.plugins.extras.lang.json" },
  { import = "lazyvim.plugins.extras.lang.yaml" },
  { import = "lazyvim.plugins.extras.lang.markdown" },
  { import = "lazyvim.plugins.extras.lang.git" },
  { import = "lazyvim.plugins.extras.lang.typescript" },
  { import = "lazyvim.plugins.extras.coding.yanky" },
  { import = "lazyvim.plugins.extras.coding.mini-surround" },
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        tsserver = { enabled = false },
        ts_ls = { enabled = false },
        vtsls = { enabled = false },
        tsgo = {
          filetypes = {
            "javascript",
            "javascriptreact",
            "javascript.jsx",
            "typescript",
            "typescriptreact",
            "typescript.tsx",
          },
          settings = {
            typescript = {
              inlayHints = {
                enumMemberValues = { enabled = true },
                functionLikeReturnTypes = { enabled = false },
                parameterNames = {
                  enabled = "literals",
                  suppressWhenArgumentMatchesName = true,
                },
                parameterTypes = { enabled = true },
                propertyDeclarationTypes = { enabled = true },
                variableTypes = { enabled = false },
              },
            },
          },
        },
      },
    },
  },
}
