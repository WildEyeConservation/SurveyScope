import Table from 'react-bootstrap/Table';
import type { CSSProperties } from 'react';
import { useState, useEffect, useRef } from 'react';
import Button from 'react-bootstrap/esm/Button';
import Form from 'react-bootstrap/Form';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { MoveUp, MoveDown } from 'lucide-react';

interface TableObject {
  tableData: { id: any; rowData: React.ReactNode[] }[];
  tableHeadings?: {
    content: string;
    style?: CSSProperties;
    sort?: boolean;
    /** Shown as a tooltip when hovering the heading. */
    description?: string;
  }[];
  pagination?: boolean;
  itemsPerPage?: number;
  emptyMessage?: string;
}

type SortDirection = 'asc' | 'desc';

const STORAGE_KEY = 'tableItemsPerPage';

export default function MyTable(input: TableObject) {
  const {
    tableData,
    tableHeadings,
    pagination = false,
    itemsPerPage: initialItemsPerPage = 5,
    emptyMessage = null,
  } = input;
  const [sortedData, setSortedData] = useState(tableData);
  const [sortConfig, setSortConfig] = useState<{
    index: number;
    direction: SortDirection;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  
  // Initialize itemsPerPage from localStorage or use default
  const getInitialItemsPerPage = () => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    return initialItemsPerPage;
  };
  
  const [itemsPerPage, setItemsPerPage] = useState(getInitialItemsPerPage);
  const prevDataRef = useRef<{ id: any }[]>([]);

  const handleSort = (index: number) => {
    let direction: SortDirection = 'asc';
    if (
      sortConfig &&
      sortConfig.index === index &&
      sortConfig.direction === 'asc'
    ) {
      direction = 'desc';
    }

    const sorted = [...sortedData].sort((a, b) => {
      const aValue = a.rowData[index];
      const bValue = b.rowData[index];

      const isNumeric = (value: string) => /^-?\d+(\.\d+)?$/.test(value);

      if (isNumeric(aValue as string) && isNumeric(bValue as string)) {
        const aNum = parseFloat(aValue as string);
        const bNum = parseFloat(bValue as string);
        if (aNum < bNum) return direction === 'asc' ? -1 : 1;
        if (aNum > bNum) return direction === 'asc' ? 1 : -1;
        return 0;
      }

      // Fallback to string comparison
      const aStr = typeof aValue === 'string' ? aValue : JSON.stringify(aValue);
      const bStr = typeof bValue === 'string' ? bValue : JSON.stringify(bValue);

      if (aStr < bStr) return direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    setSortedData(sorted);
    setSortConfig({ index, direction });
    setCurrentPage(0);
  };

  const renderSortIndicator = (index: number) => {
    if (!sortConfig || sortConfig.index !== index) return null;
    return sortConfig.direction === 'asc' ? (
      <MoveUp size={16} />
    ) : (
      <MoveDown size={16} />
    );
  };

  const totalPages = pagination
    ? Math.ceil(sortedData.length / itemsPerPage)
    : 1;
  const paginatedData = pagination
    ? sortedData.slice(
        currentPage * itemsPerPage,
        (currentPage + 1) * itemsPerPage
      )
    : sortedData;

  useEffect(() => {
    // Only reset page if the data actually changed (length or IDs changed)
    // This prevents resetting when tableData is recreated with the same content
    const prevIds = prevDataRef.current.map((item) => item.id).sort().join(',');
    const currentIds = tableData.map((item) => item.id).sort().join(',');
    const dataChanged = 
      prevDataRef.current.length !== tableData.length || 
      prevIds !== currentIds;

    setSortedData(tableData);
    
    if (dataChanged) {
      setCurrentPage(0); // reset to first page when data actually changes (e.g., search/filter)
    }
    
    prevDataRef.current = tableData;
  }, [tableData]);

  useEffect(() => {
    setCurrentPage(0); // reset to first page when itemsPerPage changes
    // Save to localStorage whenever itemsPerPage changes
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, itemsPerPage.toString());
    }
  }, [itemsPerPage]);

  if (tableData.length <= 0 && emptyMessage) {
    return (
      <div className='text-center'>
        <h5>{emptyMessage}</h5>
      </div>
    );
  }

  return (
    <div>
      <Table striped bordered hover className='border border-dark'>
        {tableHeadings && (
          <thead>
            <tr>
              {tableHeadings.map(
                ({ content, style, sort, description }, index) => {
                  const heading = (
                    <th
                      key={`heading${index}`}
                      className='bg-dark'
                      onClick={sort ? () => handleSort(index) : undefined}
                      style={{
                        cursor: sort ? 'pointer' : description ? 'help' : 'default',
                        ...style,
                      }}
                    >
                      <div className='d-flex align-items-center justify-content-between'>
                        {content}
                        {sort && renderSortIndicator(index)}
                      </div>
                    </th>
                  );
                  if (!description) return heading;
                  return (
                    <OverlayTrigger
                      key={`heading${index}`}
                      placement='top'
                      overlay={
                        <Tooltip id={`heading-tooltip-${index}`}>
                          {description}
                        </Tooltip>
                      }
                    >
                      {heading}
                    </OverlayTrigger>
                  );
                }
              )}
            </tr>
          </thead>
        )}
        <tbody>
          {paginatedData?.map((row) => (
            <tr key={row.id} className='align-middle'>
              {row.rowData.map((content, index) => (
                <td
                  key={`column${index}`}
                  style={{ backgroundColor: '#6F7B89' }}
                >
                  {content}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {pagination && (
        <div className='text-end d-flex justify-content-between align-items-center'>
          <div className='d-flex align-items-center gap-2'>
            <label htmlFor='rowsPerPage' className='mb-0'>
              Rows per page:
            </label>
            <Form.Select
              id='rowsPerPage'
              value={itemsPerPage}
              onChange={(e) => {
                const newValue = Number(e.target.value);
                setItemsPerPage(newValue);
              }}
              style={{ width: 'auto' }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Form.Select>
          </div>
          <div className='d-flex align-items-center gap-2'>
            <p className='d-inline mb-0'>
              Page {currentPage + 1} of {totalPages}
            </p>
            <div className='d-flex gap-1'>
              <Button
                variant='info'
                onClick={() => {
                  setCurrentPage((c) => c - 1);
                }}
                disabled={currentPage === 0}
              >
                &lt;
              </Button>
              <Button
                variant='info'
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={
                  currentPage === Math.ceil(sortedData.length / itemsPerPage) - 1
                }
              >
                &gt;
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
