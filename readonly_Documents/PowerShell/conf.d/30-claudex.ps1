function Invoke-ClaudeX {
    $Distro = "Ubuntu"
    $ProxyHost = "127.0.0.1"
    $ProxyPort = 8317
    $ProxyBaseUrl = "http://${ProxyHost}:${ProxyPort}"

    $ProxyKey = (
        & wsl.exe `
            --distribution $Distro `
            --exec bash -lc `
            'cat ~/.config/cli-proxy-api/client-key'
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($ProxyKey)) {
        throw "WSL側のCLIProxyAPI client-keyを取得できませんでした。"
    }

    $ProxyAvailable = Test-NetConnection `
        -ComputerName $ProxyHost `
        -Port $ProxyPort `
        -InformationLevel Quiet `
        -WarningAction SilentlyContinue

    if (-not $ProxyAvailable) {
        & wsl.exe `
            --distribution $Distro `
            --exec bash -lc `
            'systemctl --user start cli-proxy-api.service'

        $ProxyAvailable = $false

        foreach ($Attempt in 1..20) {
            Start-Sleep -Milliseconds 250

            $ProxyAvailable = Test-NetConnection `
                -ComputerName $ProxyHost `
                -Port $ProxyPort `
                -InformationLevel Quiet `
                -WarningAction SilentlyContinue

            if ($ProxyAvailable) {
                break
            }
        }

        if (-not $ProxyAvailable) {
            throw "WSL側のCLIProxyAPIが${ProxyHost}:${ProxyPort}で起動しませんでした。"
        }
    }

    $PreviousEnvironment = @{
        ANTHROPIC_API_KEY                    = $env:ANTHROPIC_API_KEY
        ANTHROPIC_BASE_URL                   = $env:ANTHROPIC_BASE_URL
        ANTHROPIC_AUTH_TOKEN                 = $env:ANTHROPIC_AUTH_TOKEN
        ANTHROPIC_DEFAULT_HAIKU_MODEL        = $env:ANTHROPIC_DEFAULT_HAIKU_MODEL
        CLAUDE_CODE_SUBAGENT_MODEL           = $env:CLAUDE_CODE_SUBAGENT_MODEL
        CLAUDE_CODE_ALWAYS_ENABLE_EFFORT     = $env:CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
        CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = $env:CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
        ENABLE_TOOL_SEARCH                   = $env:ENABLE_TOOL_SEARCH
    }

    try {
        Remove-Item `
            Env:ANTHROPIC_API_KEY `
            -ErrorAction SilentlyContinue

        $env:ANTHROPIC_BASE_URL =
            $ProxyBaseUrl

        $env:ANTHROPIC_AUTH_TOKEN =
            $ProxyKey

        $env:ANTHROPIC_DEFAULT_HAIKU_MODEL =
            "gpt-5.6-sol"

        $env:CLAUDE_CODE_SUBAGENT_MODEL =
            "gpt-5.6-sol"

        $env:CLAUDE_CODE_ALWAYS_ENABLE_EFFORT =
            "1"

        $env:CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY =
            "3"

        $env:ENABLE_TOOL_SEARCH =
            "false"

        & claude.exe `
            --model "gpt-5.6-sol" `
            @args

        $script:LASTEXITCODE = $LASTEXITCODE
    }
    finally {
        foreach ($Entry in $PreviousEnvironment.GetEnumerator()) {
            if ($null -eq $Entry.Value) {
                Remove-Item `
                    "Env:$($Entry.Key)" `
                    -ErrorAction SilentlyContinue
            }
            else {
                Set-Item `
                    "Env:$($Entry.Key)" `
                    $Entry.Value
            }
        }
    }
}

function Invoke-ClaudeDangerous {
    & claude.exe `
        --dangerously-skip-permissions `
        @args
}

function Invoke-ClaudeXDangerous {
    Invoke-ClaudeX `
        --dangerously-skip-permissions `
        @args
}

Set-Alias `
    -Name claudex `
    -Value Invoke-ClaudeX

Set-Alias `
    -Name clauded `
    -Value Invoke-ClaudeDangerous

Set-Alias `
    -Name claudexd `
    -Value Invoke-ClaudeXDangerous
