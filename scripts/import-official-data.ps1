param(
    [ValidateRange(2013, 2100)]
    [int]$FromYear = 2022,

    [ValidateRange(2013, 2100)]
    [int]$ToYear = (Get-Date).Year
)

$ErrorActionPreference = 'Stop'
$datasetId = '06779371-308f-42d7-895e-5a39833375f0'
$apiUrl = "https://data.gov.ua/api/3/action/package_show?id=$datasetId"

if ($FromYear -gt $ToYear) {
    throw 'FromYear must not be greater than ToYear.'
}

Write-Host 'Checking database state...'
docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COUNT(*) AS vehicles_before FROM vehicles;"'
if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL is unavailable or migrations have not completed.'
}

Write-Host 'Loading official resource metadata from data.gov.ua...'
$package = Invoke-RestMethod -Uri $apiUrl -Method Get
if (-not $package.success) {
    throw 'data.gov.ua returned an unsuccessful response.'
}

$resources = @(
    $package.result.resources |
        Where-Object {
            $combined = "$([string]$_.name) $([string]$_.description)"
            $yearMatch = [regex]::Match($combined, '(20\d{2})')
            $yearMatch.Success -and
            [int]$yearMatch.Groups[1].Value -ge $FromYear -and
            [int]$yearMatch.Groups[1].Value -le $ToYear -and
            ([string]$_.url -match '\.zip($|\?)')
        } |
        Sort-Object -Property created, id
)

if ($resources.Count -eq 0) {
    throw "No ZIP resources found for years $FromYear-$ToYear."
}

Write-Host "Found $($resources.Count) official resources. Import can take a long time."
$index = 0
foreach ($resource in $resources) {
    $index++
    $resourceName = if ($resource.name) { [string]$resource.name } else { "MVS resource $index" }
    Write-Host "[$index/$($resources.Count)] Importing $resourceName..."
    docker compose exec -T bot python -m data_importer `
        --url ([string]$resource.url) `
        --name $resourceName `
        --source-name 'MVS Ukraine / data.gov.ua'
    if ($LASTEXITCODE -ne 0) {
        throw "Import failed for resource: $resourceName"
    }
}

Write-Host 'Import completed. Current database state:'
docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT COUNT(*) FROM vehicles) AS vehicles, (SELECT COUNT(*) FROM registration_events) AS events;"'
