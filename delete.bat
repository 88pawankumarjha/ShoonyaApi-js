@echo off
echo Deleting files...

:: Delete specific files
del /f /q "C:\Users\88paw\OneDrive\Documents\aws\2_js\NFO_symbols.txt"
del /f /q "C:\Users\88paw\OneDrive\Documents\aws\2_js\BFO_symbols.txt"
del /f /q "C:\Users\88paw\OneDrive\Documents\aws\2_js\NFO_symbols.txt.zip"
del /f /q "C:\Users\88paw\OneDrive\Documents\aws\2_js\BFO_symbols.txt.zip"
del /f /q "C:\Users\88paw\OneDrive\Documents\aws\2_js\output.log"

:: Add more files to delete as needed
:: del /f /q "path\to\your\file.txt"

echo Files deleted.
pause