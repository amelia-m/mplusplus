# Run selected Mplus User's Guide examples through MplusAutomation, on copies,
# with OUTPUT: STANDARDIZED added and /diagram passed via a wrapper command,
# so each run writes .out and .dgm. Never touches the Mplus installation or the
# pristine example copies.
#
# Usage: Rscript tools/mplus/run-ug-examples.R <run_dir> <wrapper_variant: after|before> <ex1> [ex2 ...]
suppressPackageStartupMessages(library(MplusAutomation))

args <- commandArgs(trailingOnly = TRUE)
run_dir <- normalizePath(args[1], winslash = "/", mustWork = FALSE)
variant <- args[2]
examples <- args[-(1:2)]

repo <- "C:/Users/ameli/git/aam/mplusplus"
src_dir <- file.path(repo, "docs/reference/mplus-ug-examples/inputs")
mplus_exe <- "C:\\Program Files\\Mplus\\Mplus.exe"
dir.create(run_dir, recursive = TRUE, showWarnings = FALSE)

# Wrapper so runModels (which only passes the input file) also passes /diagram.
wrapper <- file.path(run_dir, "mplus-diagram.cmd")
line <- if (variant == "before") {
  sprintf('@"%s" /diagram %%1', mplus_exe)
} else {
  sprintf('@"%s" %%1 /diagram', mplus_exe)
}
writeLines(line, wrapper)

for (ex in examples) {
  inp_src <- file.path(src_dir, paste0(ex, ".inp"))
  stopifnot(file.exists(inp_src))
  txt <- readLines(inp_src, warn = FALSE)
  # Copy every data file the input names (FILE IS / FILE = ...).
  files <- regmatches(txt, regexpr("(?i)FILE\\s*(IS|=|ARE)?\\s*[^;]+;", txt, perl = TRUE))
  for (f in files) {
    name <- trimws(sub("(?i)^FILE\\s*(IS|=|ARE)?\\s*", "", sub(";$", "", f), perl = TRUE))
    name <- gsub('"', "", name)
    if (file.exists(file.path(src_dir, name))) {
      ok <- file.copy(file.path(src_dir, name), file.path(run_dir, name), overwrite = TRUE)
      if (!ok || !file.exists(file.path(run_dir, name))) stop("copy failed: ", name)
    }
  }
  # Add STANDARDIZED to OUTPUT (create the command if absent).
  out_idx <- grep("(?i)^\\s*OUTPUT\\s*:", txt, perl = TRUE)
  if (length(out_idx) > 0) {
    txt[out_idx[1]] <- sub("(?i)(OUTPUT\\s*:)", "\\1 STANDARDIZED;", txt[out_idx[1]], perl = TRUE)
  } else {
    txt <- c(txt, "OUTPUT: STANDARDIZED;")
  }
  writeLines(txt, file.path(run_dir, paste0(ex, ".inp")))
}

runModels(run_dir, Mplus_command = wrapper, showOutput = FALSE,
          replaceOutfile = "always", quiet = TRUE)

for (ex in examples) {
  out <- file.path(run_dir, paste0(ex, ".out"))
  dgm <- file.path(run_dir, paste0(ex, ".dgm"))
  cat(sprintf("%-7s out:%s dgm:%s", ex, file.exists(out), file.exists(dgm)))
  if (file.exists(out)) {
    m <- suppressWarnings(readModels(out, quiet = TRUE))
    secs <- names(m$parameters)
    errs <- length(m$errors)
    cat(sprintf("  parameter sections: %s  errors: %d", paste(secs, collapse = ","), errs))
  }
  cat("\n")
}
